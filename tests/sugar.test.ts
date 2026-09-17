import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import { Import } from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import {
  add,
  and,
  Assign,
  Const,
  deref,
  div,
  eq,
  expr,
  ForOf,
  gt,
  gte,
  import_,
  Let,
  lt,
  lte,
  mod,
  mul,
  neq,
  norm,
  not,
  or,
  ref,
  sub,
  type Surface,
  typeof_,
} from "../src/sugar/index.ts"
import * as Type from "../src/types/index.ts"
import { expectTypeOf } from "./typing.ts"

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
  assert.equal((asNode(n).type as Type.Any)?.tag, "literal")

  const s = norm("hi")
  expectTypeOf<typeof s>(null as any).toEqualTypeOf<Expr.Expr<"hi">>()
  assert.equal(asNode(s).value, "hi")
  assert.equal((asNode(s).type as Type.Any)?.tag, "literal")

  const b = norm(true)
  expectTypeOf<typeof b>(null as any).toEqualTypeOf<Expr.Expr<true>>()
  assert.equal(asNode(b).value, true)
  assert.equal((asNode(b).type as Type.Any)?.tag, "literal")
})

test("norm lifts arrays and plain objects recursively, preserving structure", () => {
  const arr = norm([1, "a"])
  expectTypeOf<typeof arr>(null as any).toEqualTypeOf<Expr.Expr<(string | number)[]>>()
  assert.equal((asNode(arr).type as Type.Any)?.tag, "array")
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
  assert.equal(deref(expr(node)), node)
})

test("norm throws on functions, null, undefined, and non-plain objects", () => {
  assert.throws(() => norm((() => {}) as any), /cannot lift function/)
  assert.throws(() => norm(null as any), /cannot lift null/)
  assert.throws(() => norm(undefined as any), /cannot lift undefined/)
  assert.throws(() => norm(new Date() as any), /fields must be a plain object literal/)
  const badProto = Object.create({ foo: 1 })
  assert.throws(() => norm(badProto), /fields must be a plain object literal/)
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
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<number>()
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

test("surfaces throw staging errors on primitive coercion and await", async () => {
  const s = expr(Expr.Number(42))
  assert.throws(() => `${s as any}`, /staging error: a literal node escaped/)
  assert.throws(() => (s as any) + 1, /staging error: a literal node escaped/)
  assert.throws(() => Number(s as any), /staging error: a literal node escaped/)
  await assert.rejects(async () => {
    await (s as any)
  }, /staging error: a literal node escaped/)
})

test("surfaces forward .pipe to the underlying node", () => {
  const node = Expr.Number(42)
  const s = expr(node)
  const piped = (s as any).pipe((n: any) => Expr.Binary("+", n, Expr.Number(1)))
  assert.equal(piped.tag, "binary")
  assert.equal(piped.left, node)
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
  assert.equal(mod(5, 2).op, "%")
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

test("DSL-declared functions are directly callable and return surfaces", () => {
  const program = Program.build(function*() {
    const Classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Returns(Type.Number()),
      Fn.Impl(function*({ score }) {
        return score
      }),
    )

    const label = yield* Const("label", Classify(93))
    expectTypeOf<Expr.Denotes<typeof label>>(null as any).toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const call = asNode((program.statements[1] as Binding.BindingDeclaration).expr)
  assert.equal(call.tag, "call-expr")
  const callee = asNode(call.callee)
  assert.equal(callee.tag, "function-ref")
  assert.equal(callee.nameHint, "classify")
  assert.equal(asNode(call.args[0]).value, 93)
})

test("declared refs still work as plain nodes: explicit Call, Denotes, and norm passthrough", () => {
  Program.build(function*() {
    const Identity = yield* Fn.Function("identity").pipe(
      Fn.Params(Fn.Param("value", Type.Number())),
      Fn.Returns(Type.Number()),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    expectTypeOf<ReturnType<Expr.Denotes<typeof Identity>>>(null as any).toEqualTypeOf<number>()
    assert.equal(norm(Identity), Identity)
    const explicit = Fn.Call(Identity, Expr.Number(1))
    expectTypeOf<typeof explicit.args>(null as any).toEqualTypeOf<[Expr.Literal<1>]>()
    assert.equal(explicit.tag, "call-expr")
    return explicit
  })
})

test("declared ref calls reject args of the wrong type", () => {
  Program.build(function*() {
    const Classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Returns(Type.Number()),
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
      Fn.Returns(T),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    // @ts-expect-error - generics stay explicit: Instantiate first
    assert.throws(() => Identity(1), /not a function|Identity is not a function/)
    const instantiated = Fn.Instantiate(Identity, Type.Number())
    assert.equal(instantiated.tag, "instantiation")
    return instantiated
  })
})

test("Sugar.Let and Sugar.Const define bindings with lifting", () => {
  const program = Program.build(function*() {
    const x = yield* Let("x", 1)
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    yield* Assign(x, Expr.Number(2))
    const y = yield* Const("y", 42)
    expectTypeOf<Expr.Denotes<typeof y>>(null as any).toEqualTypeOf<42>()
    return y
  })
  assert.equal(program.statements.length, 3)
  assert.equal(program.statements[0]!.tag, "let-declaration")
  assert.equal(asNode((program.statements[0] as Binding.BindingDeclaration).expr).value, 1)
  assert.equal(program.statements[1]!.tag, "assign")
  assert.equal(program.statements[2]!.tag, "const-declaration")
  assert.equal(asNode((program.statements[2] as Binding.BindingDeclaration).expr).value, 42)
})

test("Sugar.Assign lifts values and rejects readonly targets", () => {
  Program.build(function*() {
    const grade = yield* Let("grade", "F")
    yield* Assign(grade, "A+")
    const obj = yield* Let("obj", { count: 0 })
    yield* Assign(Expr.Prop(obj, "count"), 1)
    return grade
  })

  Program.build(function*() {
    const obj = yield* Binding.Let("obj").pipe(
      Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()), count: Type.Number() })),
    )
    Assign(Expr.Prop(obj, "count"), 1)
    // @ts-expect-error - id is readonly
    Assign(Expr.Prop(obj, "id"), 2)
    return obj
  })
})

test("import_ and ref hand back typed surfaces", () => {
  const fs = import_<Fs>("node:fs")
  const node = deref(fs.readFileSync("/tmp/a"))
  expectTypeOf<Expr.Denotes<typeof node>>(null as any).toEqualTypeOf<string>()

  interface Console {
    log(msg: string): void
  }
  const con = ref<Console>("console")
  const logged = deref(con.log("hi"))
  const call = asNode(logged)
  assert.equal(call.tag, "call-expr")
  assert.equal(asNode(asNode(call.callee).object).name, "console")
})

test("Sugar.ForOf iterates arrays and strings", () => {
  const program = Program.build(function*() {
    yield* ForOf("item", [1, 2], function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
    })
    yield* ForOf("literal", [1, 2] as const, function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<1 | 2>()
    })
    yield* ForOf("char", "abc", function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    return Expr.Number(0)
  })
  assert.deepEqual(program.statements.map((statement) => (statement as Stmt.ForOfStatement).nameHint), ["item", "literal", "char"])
})

test("lifted arrays widen their elements, so bindings and loops agree with Expr.Array", () => {
  Program.build(function*() {
    const values = yield* Const("values", [1, 2])
    expectTypeOf<Expr.Denotes<typeof values>>(null as any).toEqualTypeOf<number[]>()
    yield* ForOf("n", values, function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
    })
    return Expr.Number(0)
  })
})

test("type attachment: calls carry return type, binary nodes carry result type", () => {
  const sum = add(1, 2)
  assert.equal((sum.type as Type.Any)?.tag, "primitive")
  assert.equal((sum.type as any)?.name, "number")

  const check = gte(1, 2)
  assert.equal((check.type as Type.Any)?.tag, "primitive")
  assert.equal((check.type as any)?.name, "boolean")
})
