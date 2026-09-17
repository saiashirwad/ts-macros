import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import { freshBindingId } from "../src/identity.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"
import { expectTypeOf } from "./typing.ts"

test("impl return type still infers from the final expression", () => {
  Program.build(function*() {
    const identity = yield* Fn.Function("identity").pipe(
      Fn.Params(Fn.Param("value", Type.Number())),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof identity>>>(null as any).toEqualTypeOf<number>()
    return identity
  })
})

test("early returns yielded directly join the inferred return type (bare yield form)", () => {
  Program.build(function*() {
    const f = yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield Stmt.Return(Expr.String("early"))
        return x
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "early">()
    return f
  })
})

test("early returns inside an if branch reach the inferred return type", () => {
  Program.build(function*() {
    const f = yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Stmt.If(Expr.Binary("<", x, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.String("negative"))
        })
        return x
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "negative">()
    return f
  })
})

test("early returns propagate through arbitrarily nested control flow", () => {
  Program.build(function*() {
    const f = yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Stmt.While(Expr.Binary(">", x, Expr.Number(0)), function*() {
          yield* Stmt.If(Expr.Binary("===", x, Expr.Number(1)), function*() {
            yield* Stmt.Return(Expr.String("deep"))
          })
          yield* Stmt.Assign(x, Expr.Binary("-", x, Expr.Number(1)))
        })
        return x
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "deep">()
    return f
  })
})

test("elseif and else branches contribute early returns too", () => {
  Program.build(function*() {
    const f = yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Stmt.If(Expr.Binary("<", x, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.String("neg"))
        }).pipe(
          Stmt.ElseIf(Expr.Binary("===", x, Expr.Number(0)), function*() {
            yield* Stmt.Return(Expr.Boolean(true))
          }),
          Stmt.Else(function*() {
            yield* Stmt.Return(Expr.Number(-1))
          }),
        )
        return x
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<number | "neg" | true>()
    return f
  })
})

test("else closes the if builder against further clauses", () => {
  const builder = Stmt.If(Expr.Boolean(true), function*() {}).pipe(Stmt.Else(function*() {}))
  // @ts-expect-error - cannot add clauses after else
  builder.pipe(Stmt.ElseIf(Expr.Boolean(true), function*() {}))
  // @ts-expect-error - cannot else twice
  builder.pipe(Stmt.Else(function*() {}))
})

test("bodies never run unless the builder is yielded", () => {
  const ran: string[] = []
  Program.build(function*() {
    Stmt.If(Expr.Boolean(true), function*() {
      ran.push("if")
    })
    Stmt.While(Expr.Boolean(true), function*() {
      ran.push("while")
    })
    Stmt.ForOf("item", Expr.Array(Expr.Number(1)), function*() {
      ran.push("for-of")
    })
    return Expr.Number(1)
  })
  assert.deepEqual(ran, [])
})

test("a control-flow builder is a description: yielding it twice builds two independent statements", () => {
  const loop = Stmt.ForOf("item", Expr.Array(Expr.Number(1)), function*(item) {
    yield* Binding.Const("copy").pipe(Binding.Init(item))
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
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Binary(">", x, Expr.Number(0)), function*() {
      yield* Stmt.Assign(x, Expr.Number(2))
    }).pipe(
      Stmt.ElseIf(Expr.Binary("===", x, Expr.Number(0)), function*() {
        yield* Stmt.Assign(x, Expr.Number(1))
      }),
      Stmt.Else(function*() {
        yield* Stmt.Assign(x, Expr.Number(-1))
      }),
    )
    return x
  })
  const ifStatement = program.statements[1] as Stmt.IfStatement
  assert.equal(ifStatement.tag, "if")
  assert.equal(ifStatement.clauses.length, 2)
  assert.equal(ifStatement.clauses[0]!.body.tag, "block")
  assert.equal(ifStatement.clauses[0]!.body.statements[0]!.tag, "assign")
  assert.equal((ifStatement.clauses[1]!.condition as unknown as { readonly tag: string }).tag, "binary")
  assert.equal(ifStatement.else!.statements[0]!.tag, "assign")
})

test("while drains its body into a nested block", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(3)))
    yield* Stmt.While(Expr.Binary(">", x, Expr.Number(0)), function*() {
      yield* Stmt.Assign(x, Expr.Binary("-", x, Expr.Number(1)))
      yield* Stmt.Continue()
    })
    return x
  })
  const whileStatement = program.statements[1] as Stmt.WhileStatement
  assert.equal(whileStatement.tag, "while")
  assert.equal((whileStatement.condition as unknown as { readonly tag: string }).tag, "binary")
  assert.deepEqual(
    whileStatement.body.statements.map((statement) => statement.tag),
    ["assign", "continue"],
  )
})

test("let widens literal initializers so reassignment typechecks", () => {
  Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(1)))
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    Stmt.Assign(x, Expr.Number(2))
    // @ts-expect-error - a string is not assignable to a number ref
    Stmt.Assign(x, Expr.String("no"))
    return x
  })
})

test("let widening recurses into object fields", () => {
  Program.build(function*() {
    const obj = yield* Binding.Let("obj").pipe(Binding.Init(Expr.Object({ count: Expr.Number(0) })))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    Stmt.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    // @ts-expect-error - the count field denotes number
    Stmt.Assign(Expr.Prop(obj, "count"), Expr.String("no"))
    return obj
  })
})

test("for-of injects a typed loop variable and drains its body", () => {
  const program = Program.build(function*() {
    const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
    yield* Stmt.ForOf("item", Expr.Array(Expr.Number(1), Expr.Number(2)), function*(item) {
      expectTypeOf<Expr.Denotes<typeof item>>(null as any).toEqualTypeOf<number>()
      yield* Stmt.Assign(total, Expr.Binary("+", total, item))
    })
    return total
  })
  const ForOf = program.statements[1] as Stmt.ForOfStatement
  assert.equal(ForOf.tag, "for-of")
  assert.equal(ForOf.nameHint, "item")
  assert.equal(ForOf.body.tag, "block")
  assert.equal(ForOf.body.statements[0]!.tag, "assign")
})

test("for-of over a string iterates characters", () => {
  Program.build(function*() {
    yield* Stmt.ForOf("char", Expr.String("abc"), function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    return Expr.Number(0)
  })
})

test("for-of rejects non-iterables", () => {
  // @ts-expect-error - cannot iterate a number
  Stmt.ForOf("x", Expr.Number(1), function*(_x) {})
})

test("cond denotes the union of its branches", () => {
  const cond = Expr.Cond(Expr.Boolean(true), Expr.Number(1), Expr.String("s"))
  expectTypeOf<Expr.Denotes<typeof cond>>(null as any).toEqualTypeOf<1 | "s">()
  assert.equal(cond.tag, "cond")
  assert.equal((cond.else as { readonly tag: string }).tag, "literal")
})

test("function impls drain into a body block with a trailing return", () => {
  const program = Program.build(function*() {
    const identity = yield* Fn.Function("identity").pipe(
      Fn.Params(Fn.Param("value", Type.Number())),
      Fn.Impl(function*({ value }) {
        const doubled = yield* Binding.Let("doubled").pipe(Binding.Init(Expr.Binary("*", value, Expr.Number(2))))
        return doubled
      }),
    )
    return identity
  })
  const declaration = program.statements[0] as Fn.FunctionDeclaration & { readonly body: Stmt.Block }
  assert.equal(declaration.impl, undefined)
  assert.equal(declaration.body.tag, "block")
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.tag),
    ["let-declaration", "return"],
  )
  const returnStatement = declaration.body.statements[1] as Stmt.ReturnStatement
  const returned = returnStatement.value as Expr.VarRef
  assert.equal(returned.tag, "var-ref")
  assert.equal(returned.nameHint, "doubled")
})

test("return statements cannot escape to the top level", () => {
  const factory = function*() {
    yield Stmt.Return(Expr.Number(1))
    return Expr.Number(1)
  }
  // @ts-expect-error - return is function-scoped
  Program.build(factory)
})

test("break and continue are accepted only in loop bodies", () => {
  const breakProgram = function*() {
    yield Stmt.Break()
    return Expr.Number(0)
  }
  // @ts-expect-error - break requires an enclosing loop
  const _badProgram = () => Program.build(breakProgram)

  const continueProgram = function*() {
    yield Stmt.Continue()
    return Expr.Number(0)
  }
  // @ts-expect-error - continue requires an enclosing loop
  const _badContinueProgram = () => Program.build(continueProgram)

  const _badFunction = () =>
    Fn.Function("badBreak").pipe(
      // @ts-expect-error - a function body is not a loop body
      Fn.Impl(function*() {
        yield* Stmt.Break()
        return Expr.Number(0)
      }),
    )

  const _badArrow = () =>
    // @ts-expect-error - an arrow body is not a loop body
    Fn.Arrow([], function*() {
      yield* Stmt.Continue()
      return Expr.Number(0)
    })

  const badIf = Stmt.If(Expr.Boolean(true), function*() {
    yield* Stmt.Break()
  })
  const badIfBody = function*() {
    yield* badIf
    return Expr.Number(0)
  }
  // @ts-expect-error - an if alone does not provide a loop target
  const _badNestedBreak = () => Fn.Arrow([], badIfBody)
})

test("runtime validation rejects control-flow nodes that bypass the public types", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield Stmt.Break() as unknown as Stmt.ThrowStatement
        return Expr.Number(0)
      }),
    /break requires an enclosing loop/,
  )
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Fn.Function("bad").pipe(
          Fn.Impl(function*() {
            yield Stmt.Continue() as unknown as Stmt.ThrowStatement
            return Expr.Number(0)
          }),
        )
        return Expr.Number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("runtime validation resets loop context at arrow boundaries", () => {
  const badArrow = Fn.Arrow([], function*() {
    yield Stmt.Break() as unknown as Stmt.ThrowStatement
    return Expr.Number(0)
  })
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Binding.Const("badArrow").pipe(Binding.Init(badArrow))
        return Expr.Number(0)
      }),
    /break requires an enclosing loop/,
  )

  assert.throws(
    () =>
      Program.build(function*() {
        yield* Stmt.While(Expr.Boolean(true), function*() {
          yield* Stmt.Do(Fn.Call(
            FFI.Value<(callback: () => number) => void>("use"),
            Fn.Arrow([], function*() {
              yield Stmt.Continue() as unknown as Stmt.ThrowStatement
              return Expr.Number(0)
            }),
          ))
        })
        return Expr.Number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("break and continue pass through control flow nested in loops", () => {
  const program = Program.build(function*() {
    yield* Stmt.While(Expr.Boolean(true), function*() {
      yield* Stmt.If(Expr.Boolean(true), function*() {
        yield* Stmt.Continue()
      }).pipe(
        Stmt.Else(function*() {
          yield* Stmt.Break()
        }),
      )
    })
    yield* Stmt.ForOf("item", Expr.Array(Expr.Number(1)), function*(_item) {
      yield* Stmt.If(Expr.Boolean(true), function*() {
        yield* Stmt.Break()
      })
      yield* Stmt.Continue()
    })
    return Expr.Number(0)
  })

  const whileStatement = program.statements[0] as Stmt.WhileStatement
  const nestedIf = whileStatement.body.statements[0] as Stmt.IfStatement
  assert.equal(nestedIf.clauses[0]!.body.statements[0]!.tag, "continue")
  assert.equal(nestedIf.else!.statements[0]!.tag, "break")
  const forOf = program.statements[1] as Stmt.ForOfStatement
  assert.deepEqual(forOf.body.statements.map((statement) => statement.tag), ["if", "continue"])
})

test("redeclaring a name in the same scope throws", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(1)))
        yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(2)))
        return Expr.Number(0)
      }),
    /already declared in this scope/,
  )
})

test("shadowed bindings keep distinct identities and emitted names", () => {
  let outerTarget = freshBindingId()
  let innerTarget = freshBindingId()
  const program = Program.build(function*() {
    const fn = yield* Fn.Function("read").pipe(
      Fn.Impl(function*() {
        const outer = yield* Binding.Let("value").pipe(Binding.Init(Expr.Number(1)))
        outerTarget = outer.target
        yield* Stmt.If(Expr.Boolean(true), function*() {
          const inner = yield* Binding.Let("value").pipe(Binding.Init(Expr.Number(2)))
          innerTarget = inner.target
          yield* Stmt.Do(Fn.Call(FFI.Value<(value: number) => void>("use"), outer))
        })
        return outer
      }),
    )
    return fn
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
        yield* Stmt.Do(Expr.VarRef(freshBindingId(), "missing", undefined, true, false))
        return Expr.Number(0)
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("params and sibling scopes may reuse names", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("value", Type.Number())),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    yield* Binding.Let("value").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Boolean(true), function*() {
      yield* Binding.Let("tmp").pipe(Binding.Init(Expr.Number(1)))
    }).pipe(
      Stmt.Else(function*() {
        yield* Binding.Let("tmp").pipe(Binding.Init(Expr.Number(2)))
      }),
    )
    return Expr.Number(0)
  })
  assert.equal(program.statements.length, 3)
})

test("throw drains as a plain statement", () => {
  const program = Program.build(function*() {
    yield* Stmt.Throw(Expr.String("boom"))
    return Expr.Number(0)
  })
  const throwStatement = program.statements[0] as Stmt.ThrowStatement
  assert.equal(throwStatement.tag, "throw")
  assert.equal((throwStatement.value as unknown as { readonly tag: string }).tag, "literal")
})

test("const keeps top-level literal types", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Const("x").pipe(Binding.Init(Expr.Number(42)))
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<42>()
    return x
  })
  assert.equal(program.statements[0]!.tag, "const-declaration")
})

test("const widens object fields but the binding is not assignable", () => {
  Program.build(function*() {
    const obj = yield* Binding.Const("obj").pipe(Binding.Init(Expr.Object({ count: Expr.Number(0) })))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    Stmt.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    // @ts-expect-error - cannot reassign a const binding
    Stmt.Assign(obj, Expr.Object({ count: Expr.Number(1) }))
    return obj
  })
})

test("a declaration cannot be yielded until it is finished", () => {
  const unfinished = function*() {
    // @ts-expect-error - a const needs an initializer
    yield* Binding.Const("x")
    // @ts-expect-error - so does a let, unless it is declared with a type
    yield* Binding.Let("y")
    // @ts-expect-error - a function needs an implementation
    yield* Fn.Function("f")
    yield* Binding.Let("z").pipe(Binding.Declare(Type.Number()))
    // @ts-expect-error - a const cannot be declared without a value
    Binding.Const("w").pipe(Binding.Declare(Type.Number()))
  }
  void unfinished
})

test("a finished declaration takes no further steps", () => {
  const f = Fn.Function("f").pipe(Fn.Impl(function*() {
    return Expr.Number(1)
  }))
  // @ts-expect-error - the body was already checked against "no declared return type"
  f.pipe(Fn.Returns(Type.String()))
  // @ts-expect-error - one implementation
  f.pipe(Fn.Impl(function*() {
    return Expr.Number(2)
  }))

  const x = Binding.Const("x").pipe(Binding.Init(Expr.Number(1)))
  // @ts-expect-error - the initializer was already checked against "no annotation"
  x.pipe(Binding.Annotate(Type.String()))
  // @ts-expect-error - one initializer
  x.pipe(Binding.Init(Expr.Number(2)))
  // @ts-expect-error - one annotation
  Binding.Let("y").pipe(Binding.Annotate(Type.Number()), Binding.Annotate(Type.String()))
})

test("an initializer has to be assignable to the annotation", () => {
  const point = Binding.Const("point").pipe(Binding.Annotate(Type.Object({ id: Type.Number(), count: Type.Number() })))
  point.pipe(Binding.Init(Expr.Object({ id: Expr.Number(1), count: Expr.Number(2) })))
  // @ts-expect-error - the annotation promises a count the value does not have
  point.pipe(Binding.Init(Expr.Object({ id: Expr.Number(1) })))
  // @ts-expect-error - a string is not a number
  Binding.Let("n").pipe(Binding.Annotate(Type.Number()), Binding.Init(Expr.String("no")))

  // a literal is checked before it widens, so it can satisfy a literal annotation
  Program.build(function*() {
    const ok = yield* Binding.Let("ok").pipe(Binding.Annotate(Type.Literal(true)), Binding.Init(Expr.Boolean(true)))
    expectTypeOf<Expr.Denotes<typeof ok>>(null as any).toEqualTypeOf<true>()
    return null
  })
})

test("a step held in a variable is checked like one written inline", () => {
  const declared = Fn.Function("f").pipe(Fn.Returns(Type.String()))
  const impl = Fn.Impl(function*() {
    yield* Stmt.Return(Expr.Number(1))
    return Expr.String("ok")
  })
  // @ts-expect-error - built with no declared return in view, so it does not fit a draft that has one
  declared.pipe(impl)

  const annotated = Binding.Let("n").pipe(Binding.Annotate(Type.Number()))
  const init = Binding.Init(Expr.String("no"))
  // @ts-expect-error - a string is not a number
  annotated.pipe(init)
})

test("a parameter list is one TypeScript accepts", () => {
  Fn.Params(Fn.Param("a", Type.Number()), Fn.Optional("b", Type.Number()), Fn.Rest("rest", Type.Number()))
  // @ts-expect-error - a rest parameter must be last
  Fn.Params(Fn.Rest("rest", Type.Number()), Fn.Param("a", Type.Number()))
  // @ts-expect-error - a required parameter cannot follow an optional one
  Fn.Params(Fn.Optional("b", Type.Number()), Fn.Param("a", Type.Number()))
})

test("const participates in scope validation", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Binding.Const("x").pipe(Binding.Init(Expr.Number(1)))
        yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(2)))
        return Expr.Number(0)
      }),
    /already declared in this scope/,
  )
})

test("for-of loop variables are not assignable", () => {
  Program.build(function*() {
    yield* Stmt.ForOf("item", Expr.Array(Expr.Number(1)), function*(item) {
      // @ts-expect-error - the loop variable is a fresh const per iteration
      yield* Stmt.Assign(item, Expr.Number(2))
    })
    return Expr.Number(0)
  })
})

test("params remain assignable", () => {
  Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Stmt.Assign(x, Expr.Number(1))
        return x
      }),
    )
    return Expr.Number(0)
  })
})

test("yield* on plain statement data drains it", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(0)))
    yield* Stmt.Assign(x, Expr.Number(1))
    yield* Stmt.Do(Expr.Number(1))
    return x
  })
  assert.equal(program.statements[1]!.tag, "assign")
  assert.equal(program.statements[2]!.tag, "expr-statement")
})

test("bare yield of plain statement data still drains the same", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(0)))
    yield Stmt.Assign(x, Expr.Number(1))
    return x
  })
  assert.equal(program.statements[1]!.tag, "assign")
})

test("meaningless expression yields are rejected", () => {
  const bareLiteral = function*() {
    yield Expr.Number(1)
  }
  // @ts-expect-error - a literal is not a statement
  Stmt.If(Expr.Boolean(true), bareLiteral)

  const badProgram = function*() {
    yield Expr.Number(1)
    return Expr.Number(0)
  }
  // @ts-expect-error - a literal is not a top-level statement
  const _rejected = () => Program.build(badProgram)
})

test("a body is emitted as written, including what follows a return", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Impl(function*() {
        yield* Stmt.Return(Expr.Number(1))
        yield* Stmt.Do(Expr.Number(2))
        return Expr.Number(3)
      }),
    )
    return Expr.Number(0)
  })
  const declaration = program.statements[0] as Fn.FunctionDeclaration & { readonly body: Stmt.Block }
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.tag),
    ["return", "expr-statement", "return"],
  )
  // the phantom counted both returns, so the data has to as well
  const returned = (declaration.type as Type.FunctionType).return as Type.Union
  assert.deepEqual(returned.members.map((member) => (member as Type.Literal).value), [1, 3])
})

test("declared return types check early returns", () => {
  Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Returns(Type.String()),
      Fn.Impl(function*({ x }) {
        yield* Stmt.If(Expr.Binary(">", x, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.String("pos"))
        })
        return Expr.String("done")
      }),
    )
    return Expr.Number(0)
  })
})

test("declared return types reject mismatched early returns", () => {
  const declared = Fn.Function("f").pipe(
    Fn.Params(Fn.Param("x", Type.Number())),
    Fn.Returns(Type.String()),
  )
  // @ts-expect-error - the number early return does not satisfy the declared string
  declared.pipe(Fn.Impl(function*({ x: _x }) {
    yield* Stmt.Return(Expr.Number(1))
    return Expr.String("ok")
  }))
})

test("declared return types reject mismatched final expressions", () => {
  const declared = Fn.Function("f").pipe(Fn.Returns(Type.String()))
  // @ts-expect-error - the final expression does not satisfy the declared return
  declared.pipe(Fn.Impl(function*() {
    return Expr.Number(1)
  }))
})

test("assignment uses declared write types and rejects readonly targets", () => {
  Program.build(function*() {
    const obj = yield* Binding.Let("obj").pipe(Binding.Declare(Type.Object({
      id: Type.Readonly(Type.Number()),
      count: Type.Number(),
      name: Type.Optional(Type.String()),
      explicit: Type.Optional(Type.Union(Type.String(), Type.Undefined())),
      required: Type.String(),
    })))
    Stmt.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    Stmt.Assign(Expr.Prop(obj, "required"), Expr.String("ok"))
    // TODO: optional property writes exercise the declared write type below.
    Stmt.Assign(Expr.Prop(obj, "name"), Expr.String("ok"), "cannot assign to a readonly target")
    // @ts-expect-error - exact optional property writes do not accept implicit undefined
    Stmt.Assign(Expr.Prop(obj, "name"), FFI.Value<undefined>("undefinedValue"))
    Stmt.Assign(Expr.Prop(obj, "explicit"), FFI.Value<undefined>("undefinedValue"), "cannot assign to a readonly target")
    // @ts-expect-error - id is readonly
    Stmt.Assign(Expr.Prop(obj, "id"), Expr.Number(2))

    const mutableArray = yield* Binding.Let("mutableArray").pipe(Binding.Declare(Type.Array(Type.Number())))
    Stmt.Assign(Expr.Index(mutableArray, Expr.Number(0)), Expr.Number(1))
    const mutableTuple = yield* Binding.Let("mutableTuple").pipe(Binding.Declare(Type.Tuple(Type.Number(), Type.String())))
    Stmt.Assign(Expr.Index(mutableTuple, Expr.Number(0)), Expr.Number(1))
    Stmt.Assign(Expr.Index(mutableTuple, Expr.Number(1)), Expr.String("one"))
    // @ts-expect-error - tuple index 2 is out of range
    Expr.Index(mutableTuple, Expr.Number(2))
    // @ts-expect-error - negative tuple indexes are invalid
    Expr.Index(mutableTuple, Expr.Number(-1))
    // @ts-expect-error - fractional tuple indexes are invalid
    Expr.Index(mutableTuple, Expr.Number(0.5))
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    Stmt.Assign(Expr.Index(mutableTuple, Expr.Number(2)), Expr.Number(1))
    const broadIndex = FFI.Value<number>("broadIndex")
    Stmt.Assign(Expr.Index(mutableTuple, broadIndex), Expr.Number(1))
    Expr.Index(mutableArray, Expr.Number(100))
    // @ts-expect-error - tuple index 0 accepts only numbers
    Stmt.Assign(Expr.Index(mutableTuple, Expr.Number(0)), Expr.String("zero"))
    // @ts-expect-error - tuple index 1 accepts only strings
    Stmt.Assign(Expr.Index(mutableTuple, Expr.Number(1)), Expr.Number(1))

    const readonlyArray = FFI.Value<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly arrays cannot be written through an index
    Stmt.Assign(Expr.Index(readonlyArray, Expr.Number(0)), Expr.Number(1))
    const readonlyTuple = FFI.Value<readonly [number, string]>("readonlyTuple")
    // @ts-expect-error - readonly tuples cannot be written through an index
    Stmt.Assign(Expr.Index(readonlyTuple, Expr.Number(0)), Expr.Number(1))
    return obj
  })
})

test("conditions must be boolean", () => {
  const cond = Expr.Number(1)
  // @ts-expect-error - numbers are not valid conditions
  Stmt.If(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  Stmt.While(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  Expr.Cond(cond, Expr.Number(1), Expr.Number(2))
})
