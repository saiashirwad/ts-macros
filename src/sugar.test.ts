import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "./binding.ts"
import { emitProgram } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import { Import } from "./ffi.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Stmt from "./statement.ts"
import { add, and, Assign, Const, div, eq, forOf, fun, gt, gte, import_, Let, lt, lte, mul, neq, not, or, ref, sub, typeof_ } from "./sugar.ts"
import { deref, expr, norm, type Surface } from "./sugar.ts"
import * as Type from "./types/index.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const expectTypeOf = <T>(_value: T) => ({
  toEqualTypeOf: <U>(..._args: Equal<T, U> extends true ? [] : ["Type mismatch"]) => {},
})

type AnyNode = { readonly tag: string; readonly [key: string]: any }
const asNode = (x: any): AnyNode => norm(x) as unknown as AnyNode

interface Fs {
  readFileSync(path: string): string
}

test("norm lifts primitives to literal nodes, preserving literal types", () => {
  const n = norm(2)
  expectTypeOf<typeof n>(null as any).toEqualTypeOf<Expr.Expr<2>>()
  assert.equal(asNode(n).tag, "literal")
  assert.equal(asNode(n).value, 2)

  const s = norm("hi")
  expectTypeOf<typeof s>(null as any).toEqualTypeOf<Expr.Expr<"hi">>()
  assert.equal(asNode(s).value, "hi")

  const b = norm(true)
  expectTypeOf<typeof b>(null as any).toEqualTypeOf<Expr.Expr<true>>()
  assert.equal(asNode(b).value, true)
})

test("norm lifts arrays and plain objects recursively, preserving structure", () => {
  const arr = norm([1, "a"])
  expectTypeOf<typeof arr>(null as any).toEqualTypeOf<Expr.Expr<[1, "a"]>>()
  const elements = asNode(arr).elements as AnyNode[]
  assert.deepEqual(elements.map((e) => e.tag), ["literal", "literal"])

  const obj = norm({ x: 1, nested: { s: "a" } })
  expectTypeOf<typeof obj>(null as any).toEqualTypeOf<Expr.Expr<{ x: 1; nested: { s: "a" } }>>()
  const fields = asNode(obj).fields as Record<string, AnyNode>
  assert.equal(fields["x"]!.tag, "literal")
  assert.equal(fields["nested"]!.tag, "object")
})

test("norm passes nodes through unchanged", () => {
  const node = Expr.Number(2)
  assert.equal(norm(node), node)
})

test("norm derefs surfaces to the wrapped node", () => {
  const node = Expr.Prop(Import<any>("node:fs"), "readFileSync")
  assert.equal(norm(expr(node)), node)
})

test("norm throws on functions, null, and undefined", () => {
  assert.throws(() => norm((() => {}) as any), /cannot lift function/)
  assert.throws(() => norm(null as any), /cannot lift null/)
  assert.throws(() => norm(undefined as any), /cannot lift undefined/)
})

test("surfaces desugar prop access into Prop nodes", () => {
  const fs = expr(Import<Fs>("node:fs"))
  const prop = asNode(fs.readFileSync)
  assert.equal(prop.tag, "prop")
  assert.equal(prop.key, "readFileSync")
  assert.equal(asNode(prop.object).name, "fs")
})

test("surfaces desugar calls into Call nodes and lift raw args", () => {
  const fs = expr(Import<Fs>("node:fs"))
  const read = fs.readFileSync("/tmp/a")
  const node = deref(read)
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<string>()

  const call = asNode(read)
  assert.equal(call.tag, "call-expr")
  assert.equal(asNode(call.callee).key, "readFileSync")
  assert.equal(call.args.length, 1)
  assert.equal(asNode(call.args[0]).tag, "literal")
  assert.equal(asNode(call.args[0]).value, "/tmp/a")
})

test("surface calls reject args of the wrong type", () => {
  const floor = expr(Expr.Prop(Import<Math>("Math"), "floor"))
  floor(1.5)
  // @ts-expect-error - a string does not lift to Expr<number>
  floor("no")
})

test("chains compose: each step is a real Prop/Call node", () => {
  interface Vec {
    sum(): number
  }
  interface Mat {
    mul(v: Vec): Mat
    sum(): number
  }
  interface M {
    matrix(rows: number, cols: number): Mat
    vector(...xs: number[]): Vec
  }
  const m = expr(Import<M>("m"))
  const v = m.matrix(2, 2).mul(m.vector(1, 2)).sum()
  const node = deref(v)
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<number>()

  const sum = asNode(v)
  assert.equal(sum.tag, "call-expr")
  const sumCallee = asNode(sum.callee)
  assert.equal(sumCallee.tag, "prop")
  assert.equal(sumCallee.key, "sum")
  const mulCall = asNode(sumCallee.object)
  assert.equal(mulCall.tag, "call-expr")
  assert.equal(asNode(mulCall.callee).key, "mul")
  assert.equal(asNode(mulCall.args[0]).tag, "call-expr")
})

test("untyped surfaces allow arbitrary props and calls", () => {
  const anything = expr(Import("some-untyped-module"))
  const call = asNode(anything.whatever.deep(1, "two"))
  assert.equal(call.tag, "call-expr")
  assert.equal(asNode(call.callee).key, "deep")
})

test("numeric keys desugar into Index nodes", () => {
  const arr = expr(Expr.Array(Expr.Number(1), Expr.Number(2)))
  const node = deref(arr[0]!)
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<1 | 2>()
  const index = asNode(node)
  assert.equal(index.tag, "index")
  assert.equal(asNode(index.index).value, 0)
})

test("the get trap stays closed: unknown keys become Prop nodes", () => {
  const s = expr(Expr.Object({ a: Expr.Number(1) }))
  const node = deref((s as Surface<{ a: number } & Record<string, number>>).someThingNeverDefined!)
  assert.equal(asNode(node).tag, "prop")
  assert.equal(asNode(node).key, "someThingNeverDefined")
})

test("operators build Binary nodes from mixed raw and node args", () => {
  const something = Expr.Number(5)
  const sum = add(2, something)
  expectTypeOf<Expr.Denotes<typeof sum>>(null as any).toEqualTypeOf<number>()
  assert.equal(sum.tag, "binary")
  assert.equal(sum.op, "+")
  assert.equal(asNode(sum.left).tag, "literal")
  assert.equal(sum.right, something)

  assert.equal(sub(1, 2).op, "-")
  assert.equal(mul(1, 2).op, "*")
  assert.equal(div(1, 2).op, "/")
  assert.equal(eq(1, 2).op, "===")
  assert.equal(neq(1, 2).op, "!==")
  assert.equal(lt(1, 2).op, "<")
  assert.equal(lte(1, 2).op, "<=")
  assert.equal(gt(1, 2).op, ">")
  assert.equal(gte(1, 2).op, ">=")
  assert.equal(and(true, false).op, "&&")
  assert.equal(or(true, false).op, "||")
})

test("operator result types flow from BinaryResult", () => {
  const str = add("a", 1)
  expectTypeOf<Expr.Denotes<typeof str>>(null as any).toEqualTypeOf<string>()
  const cmp = lt(1, 2)
  expectTypeOf<Expr.Denotes<typeof cmp>>(null as any).toEqualTypeOf<boolean>()
  const truthy = and(Expr.Boolean(true), 1)
  expectTypeOf<Expr.Denotes<typeof truthy>>(null as any).toEqualTypeOf<true | 1>()
})

test("not and typeof_ build Unary nodes", () => {
  const negated = not(expr(Expr.Boolean(true)))
  expectTypeOf<Expr.Denotes<typeof negated>>(null as any).toEqualTypeOf<boolean>()
  assert.equal(negated.tag, "unary")
  assert.equal(negated.op, "!")
  assert.equal(asNode(negated.operand).tag, "literal")

  const t = typeof_(2)
  expectTypeOf<Expr.Denotes<typeof t>>(null as any).toEqualTypeOf<
    "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
  >()
  assert.equal(t.op, "typeof")
})

test("Init accepts raw values and still widens for let", () => {
  Program.build(function*() {
    const x = yield* Binding.Let("x").pipe(Binding.Init(2))
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    return x
  })
})

test("Init accepts surfaces and raw object literals", () => {
  const program = Program.build(function*() {
    const fs = expr(Import<Fs>("node:fs"))
    const contents = yield* Binding.Const("contents").pipe(Binding.Init(fs.readFileSync("/tmp/a")))
    expectTypeOf<Expr.Denotes<typeof contents>>(null as any).toEqualTypeOf<string>()
    const obj = yield* Binding.Let("obj").pipe(Binding.Init({ count: 0 }))
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    return contents
  })
  assert.equal(asNode((program.statements[0] as Binding.BindingDeclaration).expr).tag, "call-expr")
  assert.equal(asNode((program.statements[1] as Binding.BindingDeclaration).expr).tag, "object")
})

test("Return and Throw lift raw values", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("f").pipe(
      Fn.Impl(function*() {
        yield* Stmt.Return("early")
        return Expr.Number(1)
      }),
    )
    yield* Fn.Function("g").pipe(
      Fn.Impl(function*() {
        yield* Stmt.Throw("boom")
        return Expr.Number(0)
      }),
    )
    return Expr.Number(0)
  })
  const f = program.statements[0] as Fn.FunctionDeclaration & { readonly body: Stmt.Block }
  assert.equal(asNode((f.body.statements[0] as Stmt.ReturnStatement).value).tag, "literal")
  const g = program.statements[1] as Fn.FunctionDeclaration & { readonly body: Stmt.Block }
  assert.equal(asNode((g.body.statements[0] as Stmt.ThrowStatement).value).tag, "literal")
})

test("If and While conditions accept surfaces and raw booleans", () => {
  const program = Program.build(function*() {
    const flag = yield* Binding.Const("flag").pipe(Binding.Init(Expr.Object({ ready: Expr.Boolean(true) })))
    yield* Stmt.If(expr(flag).ready, function*() {
      yield* Stmt.Do(Expr.Number(1))
    })
    yield* Stmt.While(false, function*() {
      yield* Stmt.Break()
    })
    return flag
  })
  const ifStatement = program.statements[1] as Stmt.IfStatement
  assert.equal(asNode(ifStatement.clauses[0]!.condition).tag, "prop")
  const whileStatement = program.statements[2] as Stmt.WhileStatement
  assert.equal(asNode(whileStatement.condition).tag, "literal")
})

test("conditions must still be boolean", () => {
  // @ts-expect-error - numbers are not valid conditions
  Stmt.If(Expr.Number(1), function*() {})
  // @ts-expect-error - raw numbers are not valid conditions either
  Stmt.While(1, function*() {})
})

test("ForOf accepts raw arrays and strings", () => {
  Program.build(function*() {
    yield* Stmt.ForOf("item", [1, 2], function*(item) {
      expectTypeOf<Expr.Denotes<typeof item>>(null as any).toEqualTypeOf<1 | 2>()
    })
    yield* Stmt.ForOf("char", "abc", function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    return Expr.Number(0)
  })
})

test("ForOf still rejects non-iterables", () => {
  // @ts-expect-error - cannot iterate a number
  Stmt.ForOf("x", Expr.Number(1), function*(x) {})
  // @ts-expect-error - cannot iterate a raw number either
  Stmt.ForOf("x", 1, function*(x) {})
})

test("Let and Const define bindings without the builder pipe", () => {
  const program = Program.build(function*() {
    const x = yield* Let("x", 1)
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    yield* Expr.Assign(x, Expr.Number(2))
    const y = yield* Const("y", 42)
    expectTypeOf<Expr.Denotes<typeof y>>(null as any).toEqualTypeOf<42>()
    return y
  })
  assert.equal(program.statements[0]!.tag, "let-declaration")
  assert.equal(asNode((program.statements[0] as Binding.BindingDeclaration).expr).value, 1)
  assert.equal(program.statements[1]!.tag, "assign")
  assert.equal(program.statements[2]!.tag, "const-declaration")
  assert.equal(asNode((program.statements[2] as Binding.BindingDeclaration).expr).value, 42)
})

test("Let without a value declares uninitialized, named after the variable", () => {
  const program = Program.build(function*() {
    const x = yield* Let()
    yield* Expr.Assign(x, Expr.Number(1))
    return x
  })
  const declaration = program.statements[0] as Binding.BindingDeclaration
  assert.equal(declaration.tag, "let-declaration")
  assert.equal(declaration.name, "x")
  assert.equal(declaration.expr, undefined)
})

test("Let and Const infer the binding name from the callsite variable", () => {
  const program = Program.build(function*() {
    const answer = yield* Const(42)
    expectTypeOf<Expr.Denotes<typeof answer>>(null as any).toEqualTypeOf<42>()
    const total = yield* Let(add(1, 2))
    expectTypeOf<Expr.Denotes<typeof total>>(null as any).toEqualTypeOf<number>()
    return answer
  })
  assert.equal((program.statements[0] as Binding.BindingDeclaration).name, "answer")
  assert.equal((program.statements[1] as Binding.BindingDeclaration).name, "total")
})

test("explicit names still win over callsite inference", () => {
  const program = Program.build(function*() {
    const x = yield* Const("renamed", 42)
    return x
  })
  assert.equal((program.statements[0] as Binding.BindingDeclaration).name, "renamed")
})

test("callsite inference works from named generators and nested frames", () => {
  function* named() {
    const answer = yield* Const(42)
    return answer
  }
  const program = Program.build(named)
  assert.equal((program.statements[0] as Binding.BindingDeclaration).name, "answer")
})

test("callsite inference throws a helpful error when there is no variable to name", () => {
  assert.throws(
    () => {
      const stray = Let(1)
      void stray
    },
    /could not infer a binding name/,
  )
})

test("Let and Const lift raw values, nodes, and surfaces", () => {
  const program = Program.build(function*() {
    const fs = expr(Import<Fs>("node:fs"))
    const contents = yield* Const("contents", fs.readFileSync("/tmp/a"))
    expectTypeOf<Expr.Denotes<typeof contents>>(null as any).toEqualTypeOf<string>()
    const obj = yield* Let("obj", { count: 0 })
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    const sum = yield* Const("sum", add(1, 2))
    expectTypeOf<Expr.Denotes<typeof sum>>(null as any).toEqualTypeOf<number>()
    return sum
  })
  assert.equal(asNode((program.statements[0] as Binding.BindingDeclaration).expr).tag, "call-expr")
  assert.equal(asNode((program.statements[1] as Binding.BindingDeclaration).expr).tag, "object")
  assert.equal(asNode((program.statements[2] as Binding.BindingDeclaration).expr).tag, "binary")
})

test("Let const-widening and Annotate still compose through the returned builder", () => {
  Program.build(function*() {
    const obj = yield* Const("obj", { count: 0 })
    expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ count: number }>()
    const annotated = yield* Let().pipe(Binding.Annotate(Type.Number()))
    expectTypeOf<Expr.Denotes<typeof annotated>>(null as any).toEqualTypeOf<number>()
    return obj
  })
})

test("DSL-declared functions are directly callable and return surfaces", () => {
  const program = Program.build(function*() {
    const Classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Impl(function*({ score }) {
        return score
      }),
    )

    const label = yield* Const(Classify(93))
    expectTypeOf<Expr.Denotes<typeof label>>(null as any).toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const call = asNode((program.statements[1] as Binding.BindingDeclaration).expr)
  assert.equal(call.tag, "call-expr")
  const callee = asNode(call.callee)
  assert.equal(callee.tag, "function-ref")
  assert.equal(callee.name, "classify")
  assert.equal(asNode(call.args[0]).value, 93)
})

test("declared refs still work as plain nodes: explicit Call, Denotes, and norm passthrough", () => {
  Program.build(function*() {
    const Identity = yield* Fn.Function("identity").pipe(
      Fn.Params(Fn.Param("value", Type.Number())),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof Identity>>>(null as any).toEqualTypeOf<number>()
    assert.equal(norm(Identity), Identity)
    const explicit = Fn.Call(Identity, Expr.Number(1))
    assert.equal(explicit.tag, "call-expr")
    return explicit
  })
})

test("declared ref calls reject args of the wrong type", () => {
  Program.build(function*() {
    const Classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Impl(function*({ score }) {
        return score
      }),
    )
    Classify(93)
    // @ts-expect-error - a string does not lift to Expr<number>
    Classify("no")
    // @ts-expect-error - missing the score argument
    Classify()
    return Classify(0)
  })
})

test("generic function refs are not directly callable", () => {
  const T = Type.Param("T")
  Program.build(function*() {
    const Identity = yield* Fn.Function("identity").pipe(
      Fn.TypeParams(T),
      Fn.Params(Fn.Param("value", T)),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    // @ts-expect-error - generics stay explicit: Instantiate first
    assert.throws(() => Identity(1), /not a function/)
    const instantiated = Fn.Instantiate(Identity, Type.Number())
    assert.equal(instantiated.tag, "instantiation")
    return instantiated
  })
})

test("fun declares a whole function in one call: inferred name, typed bindings, callable ref", () => {
  const program = Program.build(function*() {
    const classify = yield* fun([Fn.Param("score", Type.Number())], function*({ score }) {
      const grade = yield* Let("F")
      yield* Assign(grade, "A")
      return grade
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof classify>>>(null as any).toEqualTypeOf<string>()
    const label = yield* Const(classify(93))
    expectTypeOf<Expr.Denotes<typeof label>>(null as any).toEqualTypeOf<string>()
    return label
  })
  const declaration = program.statements[0] as Fn.FunctionDeclaration & { readonly body: Stmt.Block }
  assert.equal(declaration.name, "classify")
  assert.equal(declaration.params.length, 1)
})

test("fun infers the return type from early and final returns, raw values included", () => {
  Program.build(function*() {
    const f = yield* fun([Fn.Param("x", Type.Number())], function*({ x }) {
      yield* Stmt.If(gt(x, 0), function*() {
        yield* Stmt.Return("pos")
      })
      return 42
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof f>>>(null as any).toEqualTypeOf<42 | "pos">()
    return f(1)
  })
})

test("fun takes an explicit name when inference should not win", () => {
  const program = Program.build(function*() {
    const f = yield* fun("renamed", [], function*() {
      return 1
    })
    return f()
  })
  assert.equal((program.statements[0] as Fn.FunctionDeclaration).name, "renamed")
})

test("Assign lifts raw values and still rejects readonly targets", () => {
  const program = Program.build(function*() {
    const grade = yield* Let("F")
    yield* Assign(grade, "A+")
    const obj = yield* Let({ count: 0 })
    yield* Assign(Expr.Prop(obj, "count"), 1)
    return grade
  })
  const assignment = program.statements[1] as Expr.Assign<any, any>
  assert.equal(asNode(assignment.value).value, "A+")

  Program.build(function*() {
    const obj = yield* Let().pipe(
      Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()), count: Type.Number() })),
    )
    Assign(Expr.Prop(obj, "count"), 1)
    // @ts-expect-error - id is readonly
    Assign(Expr.Prop(obj, "id"), 2)
    return obj
  })
})

test("if builders chain with elseif and else methods", () => {
  const program = Program.build(function*() {
    const x = yield* Let(1)
    yield* Stmt.If(gt(x, 100), function*() {
      yield* Assign(x, 3)
    }).elseif(gt(x, 50), function*() {
      yield* Assign(x, 2)
    }).else(function*() {
      yield* Assign(x, 0)
    })
    return x
  })
  const ifStatement = program.statements[1] as Stmt.IfStatement
  assert.equal(ifStatement.clauses.length, 2)
  assert.equal(ifStatement.else!.statements.length, 1)
})

test("else closes the method chain against further clauses", () => {
  const builder = Stmt.If(Expr.Boolean(true), function*() {}).else(function*() {})
  // @ts-expect-error - cannot add clauses after else
  builder.elseif(Expr.Boolean(true), function*() {})
  // @ts-expect-error - cannot else twice
  builder.else(function*() {})
})

test("import_ and ref hand back typed surfaces", () => {
  const fs = import_<Fs>("node:fs")
  const node = deref(fs.readFileSync("/tmp/a"))
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<string>()

  const con = ref<Console>("console")
  const logged = deref(con.log("hi"))
  const call = asNode(logged)
  assert.equal(call.tag, "call-expr")
  assert.equal(asNode(asNode(call.callee).object).name, "console")
})

test("forOf reads the loop variable name from the body param", () => {
  const program = Program.build(function*() {
    yield* forOf([1, 2], function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<1 | 2>()
    })
    yield* forOf("abc", function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    return Expr.Number(0)
  })
  assert.equal((program.statements[0] as Stmt.ForOfStatement).name, "n")
  assert.equal((program.statements[1] as Stmt.ForOfStatement).name, "char")
})

test("forOf still takes an explicit name", () => {
  const program = Program.build(function*() {
    yield* forOf("item", [1, 2], function*(n) {
      void n
    })
    return Expr.Number(0)
  })
  assert.equal((program.statements[0] as Stmt.ForOfStatement).name, "item")
})

test("end to end: surfaces and norm emit the same code as the explicit form", () => {
  const explicit = Program.build(function*() {
    const read = yield* Binding.Const("read").pipe(
      Binding.Init(Fn.Call(Expr.Prop(Import<any>("node:fs"), "readFileSync"), Expr.String("/tmp/a"))),
    )
    return read
  })
  const sugared = Program.build(function*() {
    const fs = expr(Import("node:fs"))
    const read = yield* Binding.Const("read").pipe(Binding.Init(fs.readFileSync("/tmp/a")))
    return read
  })
  assert.equal(emitProgram(sugared), emitProgram(explicit))
})
