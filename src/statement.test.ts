import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const expectTypeOf = <T>(_value: T) => ({
  toEqualTypeOf: <U>(..._args: Equal<T, U> extends true ? [] : ["Type mismatch"]) => {},
})

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
          yield* Expr.Assign(x, Expr.Binary("-", x, Expr.Number(1)))
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
  let ran = false
  Program.build(function*() {
    Stmt.If(Expr.Boolean(true), function*() {
      ran = true
    })
    return Expr.Number(1)
  })
  assert.equal(ran, false)
})

test("if drains its branches into nested blocks", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Binary(">", x, Expr.Number(0)), function*() {
      yield* Expr.Assign(x, Expr.Number(2))
    }).pipe(
      Stmt.ElseIf(Expr.Binary("===", x, Expr.Number(0)), function*() {
        yield* Expr.Assign(x, Expr.Number(1))
      }),
      Stmt.Else(function*() {
        yield* Expr.Assign(x, Expr.Number(-1))
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
      yield* Expr.Assign(x, Expr.Binary("-", x, Expr.Number(1)))
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
    const assignment = Expr.Assign(x, Expr.Number(2))
    expectTypeOf<Expr.Denotes<typeof assignment>>(null as any).toEqualTypeOf<number>()
    // @ts-expect-error - a string is not assignable to a number ref
    Expr.Assign(x, Expr.String("no"))
    return x
  })
})

test("let widening recurses into object fields", () => {
  Program.build(function*() {
    const obj = yield* Binding.Let("obj").pipe(Binding.Init(Expr.Object({ count: Expr.Number(0) })))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    Expr.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    // @ts-expect-error - the count field denotes number
    Expr.Assign(Expr.Prop(obj, "count"), Expr.String("no"))
    return obj
  })
})

test("for-of injects a typed loop variable and drains its body", () => {
  const program = Program.build(function*() {
    const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
    yield* Stmt.ForOf("item", Expr.Array(Expr.Number(1), Expr.Number(2)), function*(item) {
      expectTypeOf<Expr.Denotes<typeof item>>(null as any).toEqualTypeOf<1 | 2>()
      yield* Expr.Assign(total, Expr.Binary("+", total, item))
    })
    return total
  })
  const forOf = program.statements[1] as Stmt.ForOfStatement
  assert.equal(forOf.tag, "for-of")
  assert.equal(forOf.name, "item")
  assert.equal(forOf.body.tag, "block")
  assert.equal(forOf.body.statements[0]!.tag, "assign")
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
  Stmt.ForOf("x", Expr.Number(1), function*(x) {})
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
  assert.equal(returned.name, "doubled")
})

test("return statements cannot escape to the top level", () => {
  const factory = function*() {
    yield Stmt.Return(Expr.Number(1))
    return Expr.Number(1)
  }
  // @ts-expect-error - return is function-scoped
  Program.build(factory)
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

test("shadowing an outer binding inside a branch throws", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(1)))
        yield* Stmt.If(Expr.Boolean(true), function*() {
          yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(2)))
        })
        return x
      }),
    /shadows an outer binding/,
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
    Expr.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    // @ts-expect-error - cannot reassign a const binding
    Expr.Assign(obj, Expr.Object({ count: Expr.Number(1) }))
    return obj
  })
})

test("const without an initializer throws", () => {
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Binding.Const("x")
        return Expr.Number(0)
      }),
    /requires an initializer/,
  )
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
      yield* Expr.Assign(item, Expr.Number(2))
    })
    return Expr.Number(0)
  })
})

test("params remain assignable", () => {
  Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Expr.Assign(x, Expr.Number(1))
        return x
      }),
    )
    return Expr.Number(0)
  })
})

test("yield* on plain statement data drains it", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(0)))
    yield* Expr.Assign(x, Expr.Number(1))
    yield* Stmt.Do(Expr.Number(1))
    return x
  })
  assert.equal(program.statements[1]!.tag, "assign")
  assert.equal(program.statements[2]!.tag, "expr-statement")
})

test("bare yield of plain statement data still drains the same", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(Expr.Number(0)))
    yield Expr.Assign(x, Expr.Number(1))
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
  Program.build(badProgram)
})

test("statements after a terminal are pruned from the block", () => {
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
    ["return"],
  )
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
  declared.pipe(Fn.Impl(function*({ x }) {
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

test("readonly props reject assignment", () => {
  Program.build(function*() {
    const obj = yield* Binding.Let("obj").pipe(
      Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()), count: Type.Number() })),
    )
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ readonly id: number; count: number }>()
    Expr.Assign(Expr.Prop(obj, "count"), Expr.Number(1))
    // @ts-expect-error - id is readonly
    Expr.Assign(Expr.Prop(obj, "id"), Expr.Number(2))
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
