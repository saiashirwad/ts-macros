import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { freshBindingId } from "../src/node.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

const fn = T.fn

test("impl return type still infers from the final expression", () => {
  T.build(function*() {
    const identity = yield* fn("identity", {
      params: [T.param("value", T.Number)],
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof identity>>>().toEqualTypeOf<number>()
    return identity
  })
})

test("early returns yielded directly join the inferred return type (bare yield form)", () => {
  T.build(function*() {
    const f = yield* fn("f", {
      params: [T.param("x", T.Number)],
      body: function*({ x }) {
        yield T.return(T.stringLiteral("early"))
        return x
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof f>>>().toEqualTypeOf<number | "early">()
    return f
  })
})

test("early returns inside an if branch reach the inferred return type", () => {
  T.build(function*() {
    const f = yield* fn("f", {
      params: [T.param("x", T.Number)],
      body: function*({ x }) {
        yield* T.if(T.binary("<", x, T.numberLiteral(0)), function*() {
          yield* T.return(T.stringLiteral("negative"))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof f>>>().toEqualTypeOf<number | "negative">()
    return f
  })
})

test("early returns propagate through arbitrarily nested control flow", () => {
  T.build(function*() {
    const f = yield* fn("f", {
      params: [T.param("x", T.Number)],
      body: function*({ x }) {
        yield* T.while(T.binary(">", x, T.numberLiteral(0)), function*() {
          yield* T.if(T.binary("===", x, T.numberLiteral(1)), function*() {
            yield* T.return(T.stringLiteral("deep"))
          })
          yield* T.assign(x, T.binary("-", x, T.numberLiteral(1)))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof f>>>().toEqualTypeOf<number | "deep">()
    return f
  })
})

test("elseif and else branches contribute early returns too", () => {
  T.build(function*() {
    const f = yield* fn("f", {
      params: [T.param("x", T.Number)],
      body: function*({ x }) {
        yield* T.if(T.binary("<", x, T.numberLiteral(0)), function*() {
          yield* T.return(T.stringLiteral("neg"))
        }).pipe(
          T.elseIf(T.binary("===", x, T.numberLiteral(0)), function*() {
            yield* T.return(T.booleanLiteral(true))
          }),
          T.else(function*() {
            yield* T.return(T.numberLiteral(-1))
          }),
        )
        return x
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof f>>>().toEqualTypeOf<number | "neg" | true>()
    return f
  })
})

test("else closes the if builder against further clauses", () => {
  const builder = T.if(T.booleanLiteral(true), function*() {}).pipe(T.else(function*() {}))
  // @ts-expect-error - cannot add clauses after else
  builder.pipe(T.elseIf(T.booleanLiteral(true), function*() {}))
  // @ts-expect-error - cannot else twice
  builder.pipe(T.else(function*() {}))
})

test("bodies never run unless the builder is yielded", () => {
  const ran: string[] = []
  T.build(function*() {
    T.if(T.booleanLiteral(true), function*() {
      ran.push("if")
    })
    T.while(T.booleanLiteral(true), function*() {
      ran.push("while")
    })
    T.forOf("item", T.arrayLiteral(T.numberLiteral(1)), function*() {
      ran.push("for-of")
    })
    return T.numberLiteral(1)
  })
  assert.deepEqual(ran, [])
})

test("a control-flow builder is a description: yielding it twice builds two independent statements", () => {
  const loop = T.forOf("item", T.arrayLiteral(T.numberLiteral(1)), function*(item) {
    yield* T.const("copy", item)
  })
  const program = T.build(function*() {
    yield* loop
    yield* loop
    return null
  })
  const [first, second] = program.statements as T.ForOfStatement[]
  assert.notEqual(first!.id, second!.id)
})

test("if drains its branches into nested blocks", () => {
  const program = T.build(function*() {
    const x = yield* T.let("x", T.numberLiteral(1))
    yield* T.if(T.binary(">", x, T.numberLiteral(0)), function*() {
      yield* T.assign(x, T.numberLiteral(2))
    }).pipe(
      T.elseIf(T.binary("===", x, T.numberLiteral(0)), function*() {
        yield* T.assign(x, T.numberLiteral(1))
      }),
      T.else(function*() {
        yield* T.assign(x, T.numberLiteral(-1))
      }),
    )
    return x
  })
  const ifStatement = program.statements[1] as T.IfStatement
  assert.equal(ifStatement.kind, "if")
  assert.equal(ifStatement.clauses.length, 2)
  assert.equal(ifStatement.clauses[0]!.body.kind, "block")
  assert.equal(ifStatement.clauses[0]!.body.statements[0]!.kind, "assign")
  assert.equal((ifStatement.clauses[1]!.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.equal(ifStatement.else!.statements[0]!.kind, "assign")
})

test("while drains its body into a nested block", () => {
  const program = T.build(function*() {
    const x = yield* T.let("x", T.numberLiteral(3))
    yield* T.while(T.binary(">", x, T.numberLiteral(0)), function*() {
      yield* T.assign(x, T.binary("-", x, T.numberLiteral(1)))
      yield* T.continue()
    })
    return x
  })
  const whileStatement = program.statements[1] as T.WhileStatement
  assert.equal(whileStatement.kind, "while")
  assert.equal((whileStatement.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.deepEqual(
    whileStatement.body.statements.map((statement) => statement.kind),
    ["assign", "continue"],
  )
})

test("let widens literal initializers so reassignment typechecks", () => {
  T.build(function*() {
    const x = yield* T.let("x", T.numberLiteral(1))
    expectTypeOf<T.Denotes<typeof x>>().toEqualTypeOf<number>()
    T.assign(x, T.numberLiteral(2))
    // @ts-expect-error - a string is not assignable to a number ref
    T.assign(x, T.stringLiteral("no"))
    return x
  })
})

test("let widening recurses into object fields", () => {
  T.build(function*() {
    const obj = yield* T.let("obj", T.objectLiteral({ count: T.numberLiteral(0) }))
    expectTypeOf<T.Denotes<typeof obj>>().toEqualTypeOf<{ count: number }>()
    T.assign(T.prop(obj, "count"), T.numberLiteral(1))
    // @ts-expect-error - the count field denotes number
    T.assign(T.prop(obj, "count"), T.stringLiteral("no"))
    return obj
  })
})

test("for-of injects a typed loop variable and drains its body", () => {
  const program = T.build(function*() {
    const total = yield* T.let("total", T.numberLiteral(0))
    yield* T.forOf("item", T.arrayLiteral(T.numberLiteral(1), T.numberLiteral(2)), function*(item) {
      expectTypeOf<T.Denotes<typeof item>>().toEqualTypeOf<number>()
      yield* T.assign(total, T.binary("+", total, item))
    })
    return total
  })
  const ForOf = program.statements[1] as T.ForOfStatement
  assert.equal(ForOf.kind, "for-of")
  assert.equal(ForOf.nameHint, "item")
  assert.equal(ForOf.body.kind, "block")
  assert.equal(ForOf.body.statements[0]!.kind, "assign")
})

test("for-of over a string iterates characters", () => {
  T.build(function*() {
    yield* T.forOf("char", T.stringLiteral("abc"), function*(char) {
      expectTypeOf<T.Denotes<typeof char>>().toEqualTypeOf<string>()
    })
    return T.numberLiteral(0)
  })
})

test("for-of rejects non-iterables", () => {
  // @ts-expect-error - cannot iterate a number
  T.forOf("x", T.numberLiteral(1), function*(_x) {})
})

test("cond denotes the union of its branches", () => {
  const cond = T.cond(T.booleanLiteral(true), T.numberLiteral(1), T.stringLiteral("s"))
  expectTypeOf<T.Denotes<typeof cond>>().toEqualTypeOf<1 | "s">()
  assert.equal(cond.kind, "cond")
  assert.equal((cond.else as { readonly kind: string }).kind, "literal")
})

test("function impls drain into a body block with a trailing return", () => {
  const program = T.build(function*() {
    const identity = yield* fn("identity", {
      params: [T.param("value", T.Number)],
      body: function*({ value }) {
        const doubled = yield* T.let("doubled", T.binary("*", value, T.numberLiteral(2)))
        return doubled
      },
    })
    return identity
  })
  const declaration = program.statements[0] as T.BuiltFunction
  assert.equal("impl" in declaration, false)
  assert.equal(declaration.body.kind, "block")
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["let-declaration", "return"],
  )
  const returnStatement = declaration.body.statements[1] as T.ReturnStatement
  const returned = returnStatement.value as T.Ref
  assert.equal(returned.kind, "ref")
  assert.equal(returned.nameHint, "doubled")
})

test("return statements cannot escape to the top level", () => {
  const factory = function*() {
    yield T.return(T.numberLiteral(1))
    return T.numberLiteral(1)
  }
  // @ts-expect-error - return is function-scoped
  T.build(factory)
})

test("break and continue are accepted only in loop bodies", () => {
  const breakProgram = function*() {
    yield T.break()
    return T.numberLiteral(0)
  }
  // @ts-expect-error - break requires an enclosing loop
  const _badProgram = () => T.build(breakProgram)

  const continueProgram = function*() {
    yield T.continue()
    return T.numberLiteral(0)
  }
  // @ts-expect-error - continue requires an enclosing loop
  const _badContinueProgram = () => T.build(continueProgram)

  const _badFunction = () =>
    fn("badBreak", {
      // @ts-expect-error - a function body is not a loop body
      body: function*() {
        yield* T.break()
        return T.numberLiteral(0)
      },
    })

  const _badArrow = () =>
    T.arrow({
      // @ts-expect-error - an arrow body is not a loop body
      body: function*() {
        yield* T.continue()
        return T.numberLiteral(0)
      },
    })

  const badIf = T.if(T.booleanLiteral(true), function*() {
    yield* T.break()
  })
  const badIfBody = function*() {
    yield* badIf
    return T.numberLiteral(0)
  }
  // @ts-expect-error - an if alone does not provide a loop target
  const _badNestedBreak = () => T.arrow({ body: badIfBody })
})

test("runtime validation rejects control-flow nodes that bypass the public types", () => {
  assert.throws(
    () =>
      T.build(function*() {
        yield T.break() as unknown as T.ThrowStatement
        return T.numberLiteral(0)
      }),
    /break requires an enclosing loop/,
  )
  assert.throws(
    () =>
      T.build(function*() {
        yield* fn("bad", {
          body: function*() {
            yield T.continue() as unknown as T.ThrowStatement
            return T.numberLiteral(0)
          },
        })
        return T.numberLiteral(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("runtime validation resets loop context at arrow boundaries", () => {
  const badArrow = T.arrow({
    body: function*() {
      yield T.break() as unknown as T.ThrowStatement
      return T.numberLiteral(0)
    },
  })
  assert.throws(
    () =>
      T.build(function*() {
        yield* T.const("badArrow", badArrow)
        return T.numberLiteral(0)
      }),
    /break requires an enclosing loop/,
  )

  assert.throws(
    () =>
      T.build(function*() {
        yield* T.while(T.booleanLiteral(true), function*() {
          yield* T.do(T.call(
            T.hostValue<(callback: () => number) => void>("use"),
            T.arrow({
              body: function*() {
                yield T.continue() as unknown as T.ThrowStatement
                return T.numberLiteral(0)
              },
            }),
          ))
        })
        return T.numberLiteral(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("break and continue pass through control flow nested in loops", () => {
  const program = T.build(function*() {
    yield* T.while(T.booleanLiteral(true), function*() {
      yield* T.if(T.booleanLiteral(true), function*() {
        yield* T.continue()
      }).pipe(
        T.else(function*() {
          yield* T.break()
        }),
      )
    })
    yield* T.forOf("item", T.arrayLiteral(T.numberLiteral(1)), function*(_item) {
      yield* T.if(T.booleanLiteral(true), function*() {
        yield* T.break()
      })
      yield* T.continue()
    })
    return T.numberLiteral(0)
  })

  const whileStatement = program.statements[0] as T.WhileStatement
  const nestedIf = whileStatement.body.statements[0] as T.IfStatement
  assert.equal(nestedIf.clauses[0]!.body.statements[0]!.kind, "continue")
  assert.equal(nestedIf.else!.statements[0]!.kind, "break")
  const forOf = program.statements[1] as T.ForOfStatement
  assert.deepEqual(forOf.body.statements.map((statement) => statement.kind), ["if", "continue"])
})

test("redeclaring an identity in the same scope throws", () => {
  const binding = T.let("x", T.numberLiteral(1))
  assert.throws(
    () =>
      T.build(function*() {
        yield* binding
        yield* binding
        return T.numberLiteral(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("shadowed bindings keep distinct identities and emitted names", () => {
  let outerTarget = freshBindingId()
  let innerTarget = freshBindingId()
  const program = T.build(function*() {
    const read = yield* fn("read", {
      body: function*() {
        const outer = yield* T.let("value", T.numberLiteral(1))
        outerTarget = outer.id!
        yield* T.if(T.booleanLiteral(true), function*() {
          const inner = yield* T.let("value", T.numberLiteral(2))
          innerTarget = inner.id!
          yield* T.do(T.call(T.hostValue<(value: number) => void>("use"), outer))
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
      T.build(function*() {
        yield* T.do(T.ref(freshBindingId(), "missing", undefined, true, false))
        return T.numberLiteral(0)
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("params and sibling scopes may reuse names", () => {
  const program = T.build(function*() {
    yield* fn("f", {
      params: [T.param("value", T.Number)],
      body: function*({ value }) {
        return value
      },
    })
    yield* T.let("value", T.numberLiteral(1))
    yield* T.if(T.booleanLiteral(true), function*() {
      yield* T.let("tmp", T.numberLiteral(1))
    }).pipe(
      T.else(function*() {
        yield* T.let("tmp", T.numberLiteral(2))
      }),
    )
    return T.numberLiteral(0)
  })
  assert.equal(program.statements.length, 3)
})

test("throw drains as a plain statement", () => {
  const program = T.build(function*() {
    yield* T.throw(T.stringLiteral("boom"))
    return T.numberLiteral(0)
  })
  const throwStatement = program.statements[0] as T.ThrowStatement
  assert.equal(throwStatement.kind, "throw")
  assert.equal((throwStatement.value as unknown as { readonly kind: string }).kind, "literal")
})

test("const keeps top-level literal types", () => {
  const program = T.build(function*() {
    const x = yield* T.const("x", T.numberLiteral(42))
    expectTypeOf<T.Denotes<typeof x>>().toEqualTypeOf<42>()
    return x
  })
  assert.equal(program.statements[0]!.kind, "const-declaration")
})

test("const widens object fields but the binding is not assignable", () => {
  T.build(function*() {
    const obj = yield* T.const("obj", T.objectLiteral({ count: T.numberLiteral(0) }))
    expectTypeOf<T.Denotes<typeof obj>>().toEqualTypeOf<{ count: number }>()
    T.assign(T.prop(obj, "count"), T.numberLiteral(1))
    // @ts-expect-error - cannot reassign a const binding
    T.assign(obj, T.objectLiteral({ count: T.numberLiteral(1) }))
    return obj
  })
})

test("a declaration cannot be yielded until it is finished", () => {
  const unfinished = function*() {
    // @ts-expect-error - a const needs an initializer
    yield* T.const("x")
    // @ts-expect-error - so does a let, unless it is declared with a type
    yield* T.let("y")
    // @ts-expect-error - a function needs a body
    yield* fn("f")
    yield* T.let("z", T.Number)
  }
  void unfinished
})

test("a finished declaration takes no further steps", () => {
  const unused = () => {
    // @ts-expect-error - a const needs an initializer
    T.const("x")
    // @ts-expect-error - a string is not a number
    T.let("n", T.stringLiteral("no"), T.Number)
  }
  void unused
})

test("an initializer has to be assignable to the annotation", () => {
  T.const("point", T.objectLiteral({ id: T.numberLiteral(1), count: T.numberLiteral(2) }), T.Object({ id: T.Number, count: T.Number }))
  // @ts-expect-error - the annotation promises a count the value does not have
  T.const("point", T.objectLiteral({ id: T.numberLiteral(1) }), T.Object({ id: T.Number, count: T.Number }))
  // @ts-expect-error - a string is not a number
  T.let("n", T.stringLiteral("no"), T.Number)

  T.build(function*() {
    const ok = yield* T.let("ok", T.booleanLiteral(true), T.Literal(true))
    expectTypeOf<T.Denotes<typeof ok>>().toEqualTypeOf<true>()
    return null
  })
})

test("a step held in a variable is checked like one written inline", () => {
  const invalid = fn("f", {
    returns: T.String,
    body: function*() {
      yield* T.return(T.numberLiteral(1))
      return T.stringLiteral("ok")
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the number early return does not satisfy the declared string
    yield* invalid
  }
  void rejected
  // @ts-expect-error - a string is not a number
  T.let("n", T.stringLiteral("no"), T.Number)
})

test("a parameter list is one TypeScript accepts", () => {
  fn("ok", {
    params: [T.param("a", T.Number), T.optional("b", T.Number), T.rest("rest", T.Number)],
    body: function*() {
      return T.numberLiteral(0)
    },
  })
  // @ts-expect-error - a rest parameter must be last
  fn("badRest", {
    params: [T.rest("rest", T.Number), T.param("a", T.Number)],
    body: function*() {
      return T.numberLiteral(0)
    },
  })
  // @ts-expect-error - a required parameter cannot follow an optional one
  fn("badRequired", {
    params: [T.optional("b", T.Number), T.param("a", T.Number)],
    body: function*() {
      return T.numberLiteral(0)
    },
  })
})

test("const participates in scope validation", () => {
  const binding = T.const("x", T.numberLiteral(1))
  assert.throws(
    () =>
      T.build(function*() {
        yield* binding
        yield* binding
        return T.numberLiteral(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("for-of loop variables are not assignable", () => {
  const program = T.build(function*() {
    yield* T.forOf("item", T.arrayLiteral(T.numberLiteral(1)), function*(item) {
      // @ts-expect-error - the loop variable is a fresh const per iteration
      yield* T.assign(item, T.numberLiteral(2))
    })
    return T.numberLiteral(0)
  })
  const loop = program.statements[0] as T.ForOfStatement
  assert.equal(
    emitProgram(program),
    `for (const item of [1]) {
  item = 2;
}`,
  )
  assert.equal(loop.kind, "for-of")
})

test("params remain assignable", () => {
  const program = T.build(function*() {
    yield* fn("f", {
      params: [T.param("x", T.Number)],
      body: function*({ x }) {
        yield* T.assign(x, T.numberLiteral(1))
        return x
      },
    })
    return T.numberLiteral(0)
  })
  assert.equal(
    emitProgram(program),
    `function f(x: number) {
  x = 1;
  return x;
}`,
  )
})

test("yield* on plain statement data drains it", () => {
  const program = T.build(function*() {
    const x = yield* T.let("x", T.numberLiteral(0))
    yield* T.assign(x, T.numberLiteral(1))
    yield* T.do(T.numberLiteral(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "expr-statement")
})

test("bare yield of plain statement data still drains the same", () => {
  const program = T.build(function*() {
    const x = yield* T.let("x", T.numberLiteral(0))
    yield T.assign(x, T.numberLiteral(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
})

test("meaningless expression yields are rejected", () => {
  const bareLiteral = function*() {
    yield T.numberLiteral(1)
  }
  // @ts-expect-error - a literal is not a statement
  T.if(T.booleanLiteral(true), bareLiteral)

  const badProgram = function*() {
    yield T.numberLiteral(1)
    return T.numberLiteral(0)
  }
  // @ts-expect-error - a literal is not a top-level statement
  const _rejected = () => T.build(badProgram)
})

test("a body is emitted as written, including what follows a return", () => {
  const program = T.build(function*() {
    yield* fn("f", {
      body: function*() {
        yield* T.return(T.numberLiteral(1))
        yield* T.do(T.numberLiteral(2))
        return T.numberLiteral(3)
      },
    })
    return T.numberLiteral(0)
  })
  const declaration = program.statements[0] as T.BuiltFunction
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["return", "expr-statement", "return"],
  )
  const returned = (declaration.type as T.FunctionType).return as T.Union
  assert.deepEqual(returned.members.map((member) => (member as T.LiteralType).value), [1, 3])
})

test("declared return types check early returns", () => {
  const program = T.build(function*() {
    yield* fn("f", {
      params: [T.param("x", T.Number)],
      returns: T.String,
      body: function*({ x }) {
        yield* T.if(T.binary(">", x, T.numberLiteral(0)), function*() {
          yield* T.return(T.stringLiteral("pos"))
        })
        return T.stringLiteral("done")
      },
    })
    return T.numberLiteral(0)
  })
  assert.equal(
    emitProgram(program),
    `function f(x: number): string {
  if (x > 0) {
    return "pos";
  }
  return "done";
}`,
  )
})

test("declared return types reject mismatched early returns", () => {
  const invalid = fn("f", {
    params: [T.param("x", T.Number)],
    returns: T.String,
    body: function*({ x: _x }) {
      yield* T.return(T.numberLiteral(1))
      return T.stringLiteral("ok")
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
    returns: T.String,
    body: function*() {
      return T.numberLiteral(1)
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the final expression does not satisfy the declared return
    yield* invalid
  }
  void rejected
})

test("assignment uses declared write types and rejects readonly targets", () => {
  T.build(function*() {
    const obj = yield* T.let(
      "obj",
      T.Object({
        id: T.Readonly(T.Number),
        count: T.Number,
        name: T.Optional(T.String),
        explicit: T.Optional(T.Union(T.String, T.Undefined)),
        required: T.String,
      }),
    )
    T.assign(T.prop(obj, "count"), T.numberLiteral(1))
    T.assign(T.prop(obj, "required"), T.stringLiteral("ok"))
    T.assign(T.prop(obj, "name"), T.stringLiteral("ok"))
    // @ts-expect-error - exact optional property writes do not accept implicit undefined
    T.assign(T.prop(obj, "name"), T.hostValue<undefined>("undefinedValue"))
    T.assign(T.prop(obj, "explicit"), T.hostValue<undefined>("undefinedValue"))
    // @ts-expect-error - id is readonly
    T.assign(T.prop(obj, "id"), T.numberLiteral(2))

    const mutableArray = yield* T.let("mutableArray", T.Array(T.Number))
    T.assign(T.index(mutableArray, T.numberLiteral(0)), T.numberLiteral(1))
    const mutableTuple = yield* T.let("mutableTuple", T.Tuple(T.Number, T.String))
    T.assign(T.index(mutableTuple, T.numberLiteral(0)), T.numberLiteral(1))
    T.assign(T.index(mutableTuple, T.numberLiteral(1)), T.stringLiteral("one"))
    // @ts-expect-error - tuple index 2 is out of range
    T.index(mutableTuple, T.numberLiteral(2))
    // @ts-expect-error - negative tuple indexes are invalid
    T.index(mutableTuple, T.numberLiteral(-1))
    // @ts-expect-error - fractional tuple indexes are invalid
    T.index(mutableTuple, T.numberLiteral(0.5))
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    T.assign(T.index(mutableTuple, T.numberLiteral(2)), T.numberLiteral(1))
    const broadIndex = T.hostValue<number>("broadIndex")
    T.assign(T.index(mutableTuple, broadIndex), T.numberLiteral(1))
    T.index(mutableArray, T.numberLiteral(100))
    // @ts-expect-error - tuple index 0 accepts only numbers
    T.assign(T.index(mutableTuple, T.numberLiteral(0)), T.stringLiteral("zero"))
    // @ts-expect-error - tuple index 1 accepts only strings
    T.assign(T.index(mutableTuple, T.numberLiteral(1)), T.numberLiteral(1))

    const readonlyArray = T.hostValue<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly arrays cannot be written through an index
    T.assign(T.index(readonlyArray, T.numberLiteral(0)), T.numberLiteral(1))
    const readonlyTuple = T.hostValue<readonly [number, string]>("readonlyTuple")
    // @ts-expect-error - readonly tuples cannot be written through an index
    T.assign(T.index(readonlyTuple, T.numberLiteral(0)), T.numberLiteral(1))
    return obj
  })
})

test("conditions must be boolean", () => {
  const cond = T.numberLiteral(1)
  // @ts-expect-error - numbers are not valid conditions
  T.if(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  T.while(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  T.cond(cond, T.numberLiteral(1), T.numberLiteral(2))
})
