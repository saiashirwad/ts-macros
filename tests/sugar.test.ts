import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import {
  add,
  and,
  Assign,
  call,
  Const,
  div,
  eq,
  ForOf,
  gt,
  gte,
  Let,
  lt,
  lte,
  mod,
  mul,
  neq,
  norm,
  not,
  or,
  sub,
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

test("norm throws on functions, null, undefined, and non-plain objects", () => {
  assert.throws(() => norm((() => {}) as any), /cannot lift function/)
  assert.throws(() => norm(null as any), /cannot lift null/)
  assert.throws(() => norm(undefined as any), /cannot lift undefined/)
  assert.throws(() => norm(new Date() as any), /fields must be a plain object literal/)
  const badProto = Object.create({ foo: 1 })
  assert.throws(() => norm(badProto), /fields must be a plain object literal/)
})

test("call lifts its arguments and builds a Call node", () => {
  const fs = FFI.Import<Fs>("node:fs", "fs")
  const read = call(Expr.Prop(fs, "readFileSync"), "/tmp/a")
  expectTypeOf<Expr.Denotes<typeof read>>(null as any).toEqualTypeOf<string>()
  assert.equal(read.tag, "call-expr")
  assert.equal(asNode(read.callee).key, "readFileSync")
  assert.equal(read.args.length, 1)
  assert.equal(asNode(read.args[0]).tag, "literal")
  assert.equal(asNode(read.args[0]).value, "/tmp/a")
})

test("call checks its arguments against the callee", () => {
  const floor = Expr.Prop(FFI.Value<Math>("Math"), "floor")
  call(floor, 1.5)
  call(floor, Expr.Number(1.5))
  // @ts-expect-error - a string does not lift to Expr<number>
  call(floor, "no")
  // @ts-expect-error - missing the argument
  call(floor)
  // @ts-expect-error - a number is not callable
  call(Expr.Number(1))
})

test("call reaches the methods of a primitive", () => {
  const shout = call(Expr.Prop(Expr.String("hi"), "toUpperCase"))
  expectTypeOf<Expr.Denotes<typeof shout>>(null as any).toEqualTypeOf<string>()
  assert.equal(asNode(shout.callee).key, "toUpperCase")
})

test("a plain object is not a node", () => {
  // @ts-expect-error - a node carries a brand only the constructors can give it
  const forged: Expr.Expr<number> = { tag: "literal", value: 1 }
  void forged
})

test("a plain function does not lift", () => {
  // @ts-expect-error - only values lift; a function would have to be a node
  assert.throws(() => add(() => 1, 1), /cannot lift function/)
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
  const negated = not(Expr.Boolean(true))
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

test("a declared function is called with lifted arguments", () => {
  const program = Program.build(function*() {
    const Classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Returns(Type.Number()),
      Fn.Impl(function*({ score }) {
        return score
      }),
    )

    const label = yield* Const("label", call(Classify, 93))
    expectTypeOf<Expr.Denotes<typeof label>>(null as any).toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const built = asNode((program.statements[1] as Binding.BindingDeclaration).expr)
  assert.equal(built.tag, "call-expr")
  const callee = asNode(built.callee)
  assert.equal(callee.tag, "function-ref")
  assert.equal(callee.nameHint, "classify")
  assert.equal(asNode(built.args[0]).value, 93)
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
    call(Classify, 93)
    // @ts-expect-error - a string does not lift to Expr<number>
    call(Classify, "no")
    // @ts-expect-error - missing the score argument
    call(Classify)
    return call(Classify, 0)
  })
})

test("a generic function ref has to be instantiated before it is called", () => {
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
    call(Identity, 1)
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

test("Sugar.ForOf iterates arrays and strings", () => {
  const program = Program.build(function*() {
    yield* ForOf("item", [1, 2], function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
    })
    // a lifted array is an `Expr.Array`, which widens its elements whatever the plain array was
    yield* ForOf("literal", [1, 2] as const, function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
      assert.equal((n.type as Type.Primitive).name, "number")
    })
    yield* ForOf("char", "abc", function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    // @ts-expect-error - cannot iterate a number
    ForOf("n", 1, function*() {})
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
