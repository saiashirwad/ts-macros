import assert from "node:assert/strict"
import { test } from "node:test"

import { freshBindingId } from "../src/identity.ts"
import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

const fn = Decl.fn

test("impl return type still infers from the final expression", () => {
  Program.build(function*() {
    const identity = yield* fn("identity", {
      params: [Expr.param("value", Type.number)],
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof identity>>>(null as any).toEqualTypeOf<number>()
    return identity
  })
})

test("early returns yielded directly join the inferred return type (bare yield form)", () => {
  Program.build(function*() {
    const f = yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      body: function*({ x }) {
        yield Stmt.return_(Expr.string("early"))
        return x
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "early">()
    return f
  })
})

test("early returns inside an if branch reach the inferred return type", () => {
  Program.build(function*() {
    const f = yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      body: function*({ x }) {
        yield* Stmt.if_(Expr.binary("<", x, Expr.number(0)), function*() {
          yield* Stmt.return_(Expr.string("negative"))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "negative">()
    return f
  })
})

test("early returns propagate through arbitrarily nested control flow", () => {
  Program.build(function*() {
    const f = yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      body: function*({ x }) {
        yield* Stmt.while_(Expr.binary(">", x, Expr.number(0)), function*() {
          yield* Stmt.if_(Expr.binary("===", x, Expr.number(1)), function*() {
            yield* Stmt.return_(Expr.string("deep"))
          })
          yield* Stmt.assign(x, Expr.binary("-", x, Expr.number(1)))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "deep">()
    return f
  })
})

test("elseif and else branches contribute early returns too", () => {
  Program.build(function*() {
    const f = yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      body: function*({ x }) {
        yield* Stmt.if_(Expr.binary("<", x, Expr.number(0)), function*() {
          yield* Stmt.return_(Expr.string("neg"))
        }).pipe(
          Stmt.elseIf(Expr.binary("===", x, Expr.number(0)), function*() {
            yield* Stmt.return_(Expr.boolean(true))
          }),
          Stmt.else_(function*() {
            yield* Stmt.return_(Expr.number(-1))
          }),
        )
        return x
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "neg" | true>()
    return f
  })
})

test("else closes the if builder against further clauses", () => {
  const builder = Stmt.if_(Expr.boolean(true), function*() {}).pipe(Stmt.else_(function*() {}))
  // @ts-expect-error - cannot add clauses after else
  builder.pipe(Stmt.elseIf(Expr.boolean(true), function*() {}))
  // @ts-expect-error - cannot else twice
  builder.pipe(Stmt.else_(function*() {}))
})

test("bodies never run unless the builder is yielded", () => {
  const ran: string[] = []
  Program.build(function*() {
    Stmt.if_(Expr.boolean(true), function*() {
      ran.push("if")
    })
    Stmt.while_(Expr.boolean(true), function*() {
      ran.push("while")
    })
    Stmt.forOf("item", Expr.array(Expr.number(1)), function*() {
      ran.push("for-of")
    })
    return Expr.number(1)
  })
  assert.deepEqual(ran, [])
})

test("a control-flow builder is a description: yielding it twice builds two independent statements", () => {
  const loop = Stmt.forOf("item", Expr.array(Expr.number(1)), function*(item) {
    yield* Decl.const_("copy", item)
  })
  const program = Program.build(function*() {
    yield* loop
    yield* loop
    return null
  })
  const [first, second] = program.statements as Stmt.ForOfStatement[]
  assert.notEqual(first!.id, second!.id)
})

test("if drains its branches into nested blocks", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.let_("x", Expr.number(1))
    yield* Stmt.if_(Expr.binary(">", x, Expr.number(0)), function*() {
      yield* Stmt.assign(x, Expr.number(2))
    }).pipe(
      Stmt.elseIf(Expr.binary("===", x, Expr.number(0)), function*() {
        yield* Stmt.assign(x, Expr.number(1))
      }),
      Stmt.else_(function*() {
        yield* Stmt.assign(x, Expr.number(-1))
      }),
    )
    return x
  })
  const ifStatement = program.statements[1] as Stmt.IfStatement
  assert.equal(ifStatement.kind, "if")
  assert.equal(ifStatement.clauses.length, 2)
  assert.equal(ifStatement.clauses[0]!.body.kind, "block")
  assert.equal(ifStatement.clauses[0]!.body.statements[0]!.kind, "assign")
  assert.equal((ifStatement.clauses[1]!.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.equal(ifStatement.else!.statements[0]!.kind, "assign")
})

test("while drains its body into a nested block", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.let_("x", Expr.number(3))
    yield* Stmt.while_(Expr.binary(">", x, Expr.number(0)), function*() {
      yield* Stmt.assign(x, Expr.binary("-", x, Expr.number(1)))
      yield* Stmt.continue_()
    })
    return x
  })
  const whileStatement = program.statements[1] as Stmt.WhileStatement
  assert.equal(whileStatement.kind, "while")
  assert.equal((whileStatement.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.deepEqual(
    whileStatement.body.statements.map((statement) => statement.kind),
    ["assign", "continue"],
  )
})

test("let widens literal initializers so reassignment typechecks", () => {
  Program.build(function*() {
    const x = yield* Decl.let_("x", Expr.number(1))
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    Stmt.assign(x, Expr.number(2))
    // @ts-expect-error - a string is not assignable to a number ref
    Stmt.assign(x, Expr.string("no"))
    return x
  })
})

test("let widening recurses into object fields", () => {
  Program.build(function*() {
    const obj = yield* Decl.let_("obj", Expr.object({ count: Expr.number(0) }))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    Stmt.assign(Expr.prop(obj, "count"), Expr.number(1))
    // @ts-expect-error - the count field denotes number
    Stmt.assign(Expr.prop(obj, "count"), Expr.string("no"))
    return obj
  })
})

test("for-of injects a typed loop variable and drains its body", () => {
  const program = Program.build(function*() {
    const total = yield* Decl.let_("total", Expr.number(0))
    yield* Stmt.forOf("item", Expr.array(Expr.number(1), Expr.number(2)), function*(item) {
      expectTypeOf<Expr.Denotes<typeof item>>(null as any).toEqualTypeOf<number>()
      yield* Stmt.assign(total, Expr.binary("+", total, item))
    })
    return total
  })
  const ForOf = program.statements[1] as Stmt.ForOfStatement
  assert.equal(ForOf.kind, "for-of")
  assert.equal(ForOf.nameHint, "item")
  assert.equal(ForOf.body.kind, "block")
  assert.equal(ForOf.body.statements[0]!.kind, "assign")
})

test("for-of over a string iterates characters", () => {
  Program.build(function*() {
    yield* Stmt.forOf("char", Expr.string("abc"), function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    return Expr.number(0)
  })
})

test("for-of rejects non-iterables", () => {
  // @ts-expect-error - cannot iterate a number
  Stmt.forOf("x", Expr.number(1), function*(_x) {})
})

test("cond denotes the union of its branches", () => {
  const cond = Expr.cond(Expr.boolean(true), Expr.number(1), Expr.string("s"))
  expectTypeOf<Expr.Denotes<typeof cond>>(null as any).toEqualTypeOf<1 | "s">()
  assert.equal(cond.kind, "cond")
  assert.equal((cond.else as { readonly kind: string }).kind, "literal")
})

test("function impls drain into a body block with a trailing return", () => {
  const program = Program.build(function*() {
    const identity = yield* fn("identity", {
      params: [Expr.param("value", Type.number)],
      body: function*({ value }) {
        const doubled = yield* Decl.let_("doubled", Expr.binary("*", value, Expr.number(2)))
        return doubled
      },
    })
    return identity
  })
  const declaration = program.statements[0] as Decl.BuiltFunction
  assert.equal("impl" in declaration, false)
  assert.equal(declaration.body.kind, "block")
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["let-declaration", "return"],
  )
  const returnStatement = declaration.body.statements[1] as Stmt.ReturnStatement
  const returned = returnStatement.value as Expr.Ref
  assert.equal(returned.kind, "ref")
  assert.equal(returned.nameHint, "doubled")
})

test("return statements cannot escape to the top level", () => {
  const factory = function*() {
    yield Stmt.return_(Expr.number(1))
    return Expr.number(1)
  }
  // @ts-expect-error - return is function-scoped
  Program.build(factory)
})

test("break and continue are accepted only in loop bodies", () => {
  const breakProgram = function*() {
    yield Stmt.break_()
    return Expr.number(0)
  }
  // @ts-expect-error - break requires an enclosing loop
  const _badProgram = () => Program.build(breakProgram)

  const continueProgram = function*() {
    yield Stmt.continue_()
    return Expr.number(0)
  }
  // @ts-expect-error - continue requires an enclosing loop
  const _badContinueProgram = () => Program.build(continueProgram)

  const _badFunction = () =>
    fn("badBreak", {
      // @ts-expect-error - a function body is not a loop body
      body: function*() {
        yield* Stmt.break_()
        return Expr.number(0)
      },
    })

  const _badArrow = () =>
    Expr.arrow({
      // @ts-expect-error - an arrow body is not a loop body
      body: function*() {
        yield* Stmt.continue_()
        return Expr.number(0)
      },
    })

  const badIf = Stmt.if_(Expr.boolean(true), function*() {
    yield* Stmt.break_()
  })
  const badIfBody = function*() {
    yield* badIf
    return Expr.number(0)
  }
  // @ts-expect-error - an if alone does not provide a loop target
  const _badNestedBreak = () => Expr.arrow({ body: badIfBody })
})

test("runtime validation rejects control-flow nodes that bypass the public types", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield Stmt.break_() as unknown as Stmt.ThrowStatement
        return Expr.number(0)
      }),
    /break requires an enclosing loop/,
  )
  assert.throws(
    () =>
      Program.build(function*() {
        yield* fn("bad", {
          body: function*() {
            yield Stmt.continue_() as unknown as Stmt.ThrowStatement
            return Expr.number(0)
          },
        })
        return Expr.number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("runtime validation resets loop context at arrow boundaries", () => {
  const badArrow = Expr.arrow({
    body: function*() {
      yield Stmt.break_() as unknown as Stmt.ThrowStatement
      return Expr.number(0)
    },
  })
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Decl.const_("badArrow", badArrow)
        return Expr.number(0)
      }),
    /break requires an enclosing loop/,
  )

  assert.throws(
    () =>
      Program.build(function*() {
        yield* Stmt.while_(Expr.boolean(true), function*() {
          yield* Stmt.do_(Expr.call(
            FFI.Value<(callback: () => number) => void>("use"),
            Expr.arrow({
              body: function*() {
                yield Stmt.continue_() as unknown as Stmt.ThrowStatement
                return Expr.number(0)
              },
            }),
          ))
        })
        return Expr.number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("break and continue pass through control flow nested in loops", () => {
  const program = Program.build(function*() {
    yield* Stmt.while_(Expr.boolean(true), function*() {
      yield* Stmt.if_(Expr.boolean(true), function*() {
        yield* Stmt.continue_()
      }).pipe(
        Stmt.else_(function*() {
          yield* Stmt.break_()
        }),
      )
    })
    yield* Stmt.forOf("item", Expr.array(Expr.number(1)), function*(_item) {
      yield* Stmt.if_(Expr.boolean(true), function*() {
        yield* Stmt.break_()
      })
      yield* Stmt.continue_()
    })
    return Expr.number(0)
  })

  const whileStatement = program.statements[0] as Stmt.WhileStatement
  const nestedIf = whileStatement.body.statements[0] as Stmt.IfStatement
  assert.equal(nestedIf.clauses[0]!.body.statements[0]!.kind, "continue")
  assert.equal(nestedIf.else!.statements[0]!.kind, "break")
  const forOf = program.statements[1] as Stmt.ForOfStatement
  assert.deepEqual(forOf.body.statements.map((statement) => statement.kind), ["if", "continue"])
})

test("redeclaring an identity in the same scope throws", () => {
  const binding = Decl.let_("x", Expr.number(1))
  assert.throws(
    () =>
      Program.build(function*() {
        yield* binding
        yield* binding
        return Expr.number(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("shadowed bindings keep distinct identities and emitted names", () => {
  let outerTarget = freshBindingId()
  let innerTarget = freshBindingId()
  const program = Program.build(function*() {
    const read = yield* fn("read", {
      body: function*() {
        const outer = yield* Decl.let_("value", Expr.number(1))
        outerTarget = outer.id!
        yield* Stmt.if_(Expr.boolean(true), function*() {
          const inner = yield* Decl.let_("value", Expr.number(2))
          innerTarget = inner.id!
          yield* Stmt.do_(Expr.call(FFI.Value<(value: number) => void>("use"), outer))
        })
        return outer
      },
    })
    return read
  })

  assert.notEqual(outerTarget, innerTarget)
  assert.match(emitProgram(program), /let value = 1;/)
  assert.match(emitProgram(program), /let value_2 = 2;/)
  assert.match(emitProgram(program), /use\(value\);/)
})

test("a local reference must target an in-scope declaration", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Stmt.do_(Expr.ref(freshBindingId(), "missing", undefined, true, false))
        return Expr.number(0)
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("params and sibling scopes may reuse names", () => {
  const program = Program.build(function*() {
    yield* fn("f", {
      params: [Expr.param("value", Type.number)],
      body: function*({ value }) {
        return value
      },
    })
    yield* Decl.let_("value", Expr.number(1))
    yield* Stmt.if_(Expr.boolean(true), function*() {
      yield* Decl.let_("tmp", Expr.number(1))
    }).pipe(
      Stmt.else_(function*() {
        yield* Decl.let_("tmp", Expr.number(2))
      }),
    )
    return Expr.number(0)
  })
  assert.equal(program.statements.length, 3)
})

test("throw drains as a plain statement", () => {
  const program = Program.build(function*() {
    yield* Stmt.throw_(Expr.string("boom"))
    return Expr.number(0)
  })
  const throwStatement = program.statements[0] as Stmt.ThrowStatement
  assert.equal(throwStatement.kind, "throw")
  assert.equal((throwStatement.value as unknown as { readonly kind: string }).kind, "literal")
})

test("const keeps top-level literal types", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.const_("x", Expr.number(42))
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<42>()
    return x
  })
  assert.equal(program.statements[0]!.kind, "const-declaration")
})

test("const widens object fields but the binding is not assignable", () => {
  Program.build(function*() {
    const obj = yield* Decl.const_("obj", Expr.object({ count: Expr.number(0) }))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    Stmt.assign(Expr.prop(obj, "count"), Expr.number(1))
    // @ts-expect-error - cannot reassign a const binding
    Stmt.assign(obj, Expr.object({ count: Expr.number(1) }))
    return obj
  })
})

test("a declaration cannot be yielded until it is finished", () => {
  const unfinished = function*() {
    // @ts-expect-error - a const needs an initializer
    yield* Decl.const_("x")
    // @ts-expect-error - so does a let, unless it is declared with a type
    yield* Decl.let_("y")
    // @ts-expect-error - a function needs a body
    yield* fn("f")
    yield* Decl.let_("z", Type.number)
  }
  void unfinished
})

test("a finished declaration takes no further steps", () => {
  const unused = () => {
    // @ts-expect-error - a const needs an initializer
    Decl.const_("x")
    // @ts-expect-error - a string is not a number
    Decl.let_("n", Expr.string("no"), Type.number)
  }
  void unused
})

test("an initializer has to be assignable to the annotation", () => {
  Decl.const_("point", Expr.object({ id: Expr.number(1), count: Expr.number(2) }), Type.object({ id: Type.number, count: Type.number }))
  // @ts-expect-error - the annotation promises a count the value does not have
  Decl.const_("point", Expr.object({ id: Expr.number(1) }), Type.object({ id: Type.number, count: Type.number }))
  // @ts-expect-error - a string is not a number
  Decl.let_("n", Expr.string("no"), Type.number)

  Program.build(function*() {
    const ok = yield* Decl.let_("ok", Expr.boolean(true), Type.literal(true))
    expectTypeOf<Expr.Denotes<typeof ok>>(null as any).toEqualTypeOf<true>()
    return null
  })
})

test("a step held in a variable is checked like one written inline", () => {
  const invalid = fn("f", {
    returns: Type.string,
    body: function*() {
      yield* Stmt.return_(Expr.number(1))
      return Expr.string("ok")
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the number early return does not satisfy the declared string
    yield* invalid
  }
  void rejected
  // @ts-expect-error - a string is not a number
  Decl.let_("n", Expr.string("no"), Type.number)
})

test("a parameter list is one TypeScript accepts", () => {
  fn("ok", {
    params: [Expr.param("a", Type.number), Expr.optional("b", Type.number), Expr.rest("rest", Type.number)],
    body: function*() {
      return Expr.number(0)
    },
  })
  // @ts-expect-error - a rest parameter must be last
  fn("badRest", {
    params: [Expr.rest("rest", Type.number), Expr.param("a", Type.number)],
    body: function*() {
      return Expr.number(0)
    },
  })
  // @ts-expect-error - a required parameter cannot follow an optional one
  fn("badRequired", {
    params: [Expr.optional("b", Type.number), Expr.param("a", Type.number)],
    body: function*() {
      return Expr.number(0)
    },
  })
})

test("const participates in scope validation", () => {
  const binding = Decl.const_("x", Expr.number(1))
  assert.throws(
    () =>
      Program.build(function*() {
        yield* binding
        yield* binding
        return Expr.number(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("for-of loop variables are not assignable", () => {
  Program.build(function*() {
    yield* Stmt.forOf("item", Expr.array(Expr.number(1)), function*(item) {
      // @ts-expect-error - the loop variable is a fresh const per iteration
      yield* Stmt.assign(item, Expr.number(2))
    })
    return Expr.number(0)
  })
})

test("params remain assignable", () => {
  Program.build(function*() {
    yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      body: function*({ x }) {
        yield* Stmt.assign(x, Expr.number(1))
        return x
      },
    })
    return Expr.number(0)
  })
})

test("yield* on plain statement data drains it", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.let_("x", Expr.number(0))
    yield* Stmt.assign(x, Expr.number(1))
    yield* Stmt.do_(Expr.number(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "expr-statement")
})

test("bare yield of plain statement data still drains the same", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.let_("x", Expr.number(0))
    yield Stmt.assign(x, Expr.number(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
})

test("meaningless expression yields are rejected", () => {
  const bareLiteral = function*() {
    yield Expr.number(1)
  }
  // @ts-expect-error - a literal is not a statement
  Stmt.if_(Expr.boolean(true), bareLiteral)

  const badProgram = function*() {
    yield Expr.number(1)
    return Expr.number(0)
  }
  // @ts-expect-error - a literal is not a top-level statement
  const _rejected = () => Program.build(badProgram)
})

test("a body is emitted as written, including what follows a return", () => {
  const program = Program.build(function*() {
    yield* fn("f", {
      body: function*() {
        yield* Stmt.return_(Expr.number(1))
        yield* Stmt.do_(Expr.number(2))
        return Expr.number(3)
      },
    })
    return Expr.number(0)
  })
  const declaration = program.statements[0] as Decl.BuiltFunction
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["return", "expr-statement", "return"],
  )
  const returned = (declaration.type as Type.FunctionType).return as Type.Union
  assert.deepEqual(returned.members.map((member) => (member as Type.Literal).value), [1, 3])
})

test("declared return types check early returns", () => {
  Program.build(function*() {
    yield* fn("f", {
      params: [Expr.param("x", Type.number)],
      returns: Type.string,
      body: function*({ x }) {
        yield* Stmt.if_(Expr.binary(">", x, Expr.number(0)), function*() {
          yield* Stmt.return_(Expr.string("pos"))
        })
        return Expr.string("done")
      },
    })
    return Expr.number(0)
  })
})

test("declared return types reject mismatched early returns", () => {
  const invalid = fn("f", {
    params: [Expr.param("x", Type.number)],
    returns: Type.string,
    body: function*({ x: _x }) {
      yield* Stmt.return_(Expr.number(1))
      return Expr.string("ok")
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the number early return does not satisfy the declared string
    yield* invalid
  }
  void rejected
})

test("declared return types reject mismatched final expressions", () => {
  const invalid = fn("f", {
    returns: Type.string,
    body: function*() {
      return Expr.number(1)
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the final expression does not satisfy the declared return
    yield* invalid
  }
  void rejected
})

test("assignment uses declared write types and rejects readonly targets", () => {
  Program.build(function*() {
    const obj = yield* Decl.let_(
      "obj",
      Type.object({
        id: Type.readonly_(Type.number),
        count: Type.number,
        name: Type.optional(Type.string),
        explicit: Type.optional(Type.union(Type.string, Type.undefined_)),
        required: Type.string,
      }),
    )
    Stmt.assign(Expr.prop(obj, "count"), Expr.number(1))
    Stmt.assign(Expr.prop(obj, "required"), Expr.string("ok"))
    Stmt.assign(Expr.prop(obj, "name"), Expr.string("ok"))
    // @ts-expect-error - exact optional property writes do not accept implicit undefined
    Stmt.assign(Expr.prop(obj, "name"), FFI.Value<undefined>("undefinedValue"))
    Stmt.assign(Expr.prop(obj, "explicit"), FFI.Value<undefined>("undefinedValue"))
    // @ts-expect-error - id is readonly
    Stmt.assign(Expr.prop(obj, "id"), Expr.number(2))

    const mutableArray = yield* Decl.let_("mutableArray", Type.array(Type.number))
    Stmt.assign(Expr.index(mutableArray, Expr.number(0)), Expr.number(1))
    const mutableTuple = yield* Decl.let_("mutableTuple", Type.tuple(Type.number, Type.string))
    Stmt.assign(Expr.index(mutableTuple, Expr.number(0)), Expr.number(1))
    Stmt.assign(Expr.index(mutableTuple, Expr.number(1)), Expr.string("one"))
    // @ts-expect-error - tuple index 2 is out of range
    Expr.index(mutableTuple, Expr.number(2))
    // @ts-expect-error - negative tuple indexes are invalid
    Expr.index(mutableTuple, Expr.number(-1))
    // @ts-expect-error - fractional tuple indexes are invalid
    Expr.index(mutableTuple, Expr.number(0.5))
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    Stmt.assign(Expr.index(mutableTuple, Expr.number(2)), Expr.number(1))
    const broadIndex = FFI.Value<number>("broadIndex")
    Stmt.assign(Expr.index(mutableTuple, broadIndex), Expr.number(1))
    Expr.index(mutableArray, Expr.number(100))
    // @ts-expect-error - tuple index 0 accepts only numbers
    Stmt.assign(Expr.index(mutableTuple, Expr.number(0)), Expr.string("zero"))
    // @ts-expect-error - tuple index 1 accepts only strings
    Stmt.assign(Expr.index(mutableTuple, Expr.number(1)), Expr.number(1))

    const readonlyArray = FFI.Value<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly arrays cannot be written through an index
    Stmt.assign(Expr.index(readonlyArray, Expr.number(0)), Expr.number(1))
    const readonlyTuple = FFI.Value<readonly [number, string]>("readonlyTuple")
    // @ts-expect-error - readonly tuples cannot be written through an index
    Stmt.assign(Expr.index(readonlyTuple, Expr.number(0)), Expr.number(1))
    return obj
  })
})

test("conditions must be boolean", () => {
  const cond = Expr.number(1)
  // @ts-expect-error - numbers are not valid conditions
  Stmt.if_(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  Stmt.while_(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  Expr.cond(cond, Expr.number(1), Expr.number(2))
})
