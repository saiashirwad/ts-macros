import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { expectTypeOf } from "./typing.ts"

const fn = T.fn

type AnyNode = { readonly kind: string; readonly [key: string]: any }
const asNode = (x: any): AnyNode => T.lift(x as never) as unknown as AnyNode

interface Fs {
  readFileSync(path: string): string
}

test("lift lifts primitives to literal nodes, and says so in its type", () => {
  const n = T.lift(2)
  expectTypeOf<typeof n>().toEqualTypeOf<T.LiteralExpr<2>>()
  assert.equal(asNode(n).kind, "literal")
  assert.equal(asNode(n).value, 2)
  assert.equal((asNode(n).type as T.AnyType)?.kind, "literal")

  const s = T.lift("hi")
  expectTypeOf<typeof s>().toEqualTypeOf<T.LiteralExpr<"hi">>()
  assert.equal(asNode(s).value, "hi")
  assert.equal((asNode(s).type as T.AnyType)?.kind, "literal")

  const b = T.lift(true)
  expectTypeOf<typeof b>().toEqualTypeOf<T.LiteralExpr<true>>()
  assert.equal(asNode(b).value, true)
  assert.equal((asNode(b).type as T.AnyType)?.kind, "literal")
})

test("lift lifts arrays and plain objects recursively, preserving structure", () => {
  const arr = T.lift([1, "a"])
  expectTypeOf<T.Denotes<typeof arr>>().toEqualTypeOf<(string | number)[]>()
  assert.equal((asNode(arr).type as T.AnyType)?.kind, "array")
  const elements = asNode(arr).elements as AnyNode[]
  assert.deepEqual(elements.map((e) => e.kind), ["literal", "literal"])

  const obj = T.lift({ x: 1, nested: { s: "a" } })
  expectTypeOf<T.Denotes<typeof obj>>().toEqualTypeOf<{ x: number; nested: { s: string } }>()
  const fields = asNode(obj).fields as Record<string, AnyNode>
  assert.equal(fields["x"]!.kind, "literal")
  assert.equal(fields["nested"]!.kind, "object")
})

test("lift passes nodes through unchanged", () => {
  const node = T.numberLiteral(2)
  assert.equal(T.lift(node), node)
})

test("lift rejects unsupported objects and fields without invoking accessors", () => {
  assert.throws(() => T.lift((() => {}) as any), /cannot lift function/)
  assert.throws(() => T.lift(null as any), /cannot lift null/)
  assert.throws(() => T.lift(undefined as any), /cannot lift undefined/)
  assert.throws(() => T.lift(new Date() as any), /fields must be a plain object literal with Object\.prototype/)
  assert.throws(() => T.lift(Object.create(null) as any), /fields must be a plain object literal with Object\.prototype/)

  class RecordClass {
    value = 1
  }
  assert.throws(() => T.lift(new RecordClass() as any), /fields must be a plain object literal with Object\.prototype/)
  const badProto = Object.create({ foo: 1 })
  assert.throws(() => T.lift(badProto), /fields must be a plain object literal with Object\.prototype/)

  const symbol = Symbol("hidden")
  const symbolFields = { visible: 1, [symbol]: 2 }
  const rejectSymbolFields = () => {
    // @ts-expect-error - T.objectLiteral cannot represent symbol-keyed fields
    T.lift(symbolFields)
  }
  void rejectSymbolFields
  assert.throws(() => T.lift(symbolFields as any), /fields must not have symbol keys/)

  const nonEnumerable = { visible: 1 }
  Object.defineProperty(nonEnumerable, "hidden", { value: 2, enumerable: false })
  assert.throws(() => T.lift(nonEnumerable), /field "hidden" must be enumerable/)

  let reads = 0
  const accessor = Object.defineProperty({ visible: 1 }, "computed", {
    enumerable: true,
    get() {
      reads++
      return 2
    },
  })
  assert.throws(() => T.lift(accessor), /field "computed" must be a data property, not an accessor/)
  assert.equal(reads, 0)
})

test("lift rejects unique symbol brands and accepts ordinary nested records", () => {
  const brand: unique symbol = Symbol("brand")
  type Branded = { value: number; [brand]: true }
  const branded: Branded = { value: 1, [brand]: true }
  expectTypeOf<T.Lift<Branded>>(undefined as never).toEqualTypeOf<never>()
  expectTypeOf<T.Lift<{ [key: symbol]: number }>>(undefined as never).toEqualTypeOf<never>()

  const rejectBranded = () => {
    // @ts-expect-error - unique symbol brands cannot be represented by T.objectLiteral
    T.lift(branded)
  }
  void rejectBranded

  const ordinary = {
    user: { name: "Ada" as string, flags: { active: true as boolean } },
    count: 1 as number,
  }
  const lifted = T.lift(ordinary)
  expectTypeOf<T.Denotes<typeof lifted>>().toEqualTypeOf<typeof ordinary>()
  assert.equal(asNode(lifted).kind, "object")
})

test("call lifts its arguments and builds a Call node", () => {
  const fs = T.hostImport<Fs>("node:fs", "fs")
  const read = T.call(T.prop(fs, "readFileSync"), "/tmp/a")
  expectTypeOf<T.Denotes<typeof read>>().toEqualTypeOf<string>()
  assert.equal(read.kind, "call")
  assert.equal(asNode(read.callee).key, "readFileSync")
  assert.equal(read.args.length, 1)
  assert.equal(asNode(read.args[0]).kind, "literal")
  assert.equal(asNode(read.args[0]).value, "/tmp/a")
})

test("call checks its arguments against the callee", () => {
  const floor = T.hostValue<(x: number) => number>("floor")
  T.call(floor, 1.5)
  T.call(floor, T.numberLiteral(1.5))
  // @ts-expect-error - a string does not lift to Expr<number>
  T.call(floor, "no")
  // @ts-expect-error - missing the argument
  T.call(floor)
  // @ts-expect-error - a number is not callable
  T.call(T.numberLiteral(1))
})

test("call reaches the methods of a primitive", () => {
  const shout = T.call(T.prop(T.stringLiteral("hi"), "toUpperCase"))
  expectTypeOf<T.Denotes<typeof shout>>().toEqualTypeOf<string>()
  assert.equal(asNode(shout.callee).key, "toUpperCase")
})

test("a plain object is not a node", () => {
  // @ts-expect-error - a node carries a brand only the constructors can give it
  const forged: T.Expr<number> = { kind: "literal", value: 1 }
  void forged
})

test("a plain function does not lift", () => {
  // @ts-expect-error - only values lift; a function would have to be a node
  assert.throws(() => T.add(() => 1, 1), /cannot lift function/)
})

test("operators build Binary nodes from mixed raw and node args", () => {
  const something = T.numberLiteral(5)
  const sum = T.add(2, something)
  expectTypeOf<T.Denotes<typeof sum>>().toEqualTypeOf<number>()
  assert.equal(sum.kind, "binary")
  assert.equal(sum.op, "+")
  assert.equal(asNode(sum.left).kind, "literal")
  assert.equal(sum.right, something)

  assert.equal(T.sub(1, 2).op, "-")
  assert.equal(T.mul(1, 2).op, "*")
  assert.equal(T.div(1, 2).op, "/")
  assert.equal(T.mod(5, 2).op, "%")
  assert.equal(T.eq(1, 1).op, "===")
  assert.equal(T.neq(1, 1).op, "!==")
  assert.equal(T.lt(1, 2).op, "<")
  assert.equal(T.lte(1, 2).op, "<=")
  assert.equal(T.gt(1, 2).op, ">")
  assert.equal(T.gte(1, 2).op, ">=")
  assert.equal(T.and(true, false).op, "&&")
  assert.equal(T.or(true, false).op, "||")
})

test("operator result types flow from BinaryResult", () => {
  const str = T.add("a", 1)
  expectTypeOf<T.Denotes<typeof str>>().toEqualTypeOf<string>()
  const cmp = T.lt(1, 2)
  expectTypeOf<T.Denotes<typeof cmp>>().toEqualTypeOf<boolean>()
  const truthy = T.and(T.booleanLiteral(true), 1)
  expectTypeOf<T.Denotes<typeof truthy>>().toEqualTypeOf<1>()
})

test("not and typeof build Unary nodes", () => {
  const negated = T.not(T.booleanLiteral(true))
  expectTypeOf<T.Denotes<typeof negated>>().toEqualTypeOf<boolean>()
  assert.equal(negated.kind, "unary")
  assert.equal(negated.op, "!")
  assert.equal(asNode(negated.operand).kind, "literal")

  const t = T.typeof(2)
  expectTypeOf<T.Denotes<typeof t>>().toEqualTypeOf<
    "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
  >()
  assert.equal(t.op, "typeof")
})

test("a declared function is called with lifted arguments", () => {
  const program = T.build(function*() {
    const Classify = yield* fn("classify", {
      params: [T.param("score", T.Number)],
      returns: T.Number,
      body: function*({ score }) {
        return score
      },
    })

    const label = yield* T.const("label", T.call(Classify, 93))
    expectTypeOf<T.Denotes<typeof label>>().toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const built = asNode((program.statements[1] as T.BindingDeclaration).expr)
  assert.equal(built.kind, "call")
  const callee = asNode(built.callee)
  assert.equal(callee.kind, "ref")
  assert.equal(callee.nameHint, "classify")
  assert.equal(asNode(built.args[0]).value, 93)
})

test("declared refs still work as plain nodes: explicit Call, Denotes, and lift passthrough", () => {
  T.build(function*() {
    const Identity = yield* fn("identity", {
      params: [T.param("value", T.Number)],
      returns: T.Number,
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<T.Denotes<typeof Identity>>>().toEqualTypeOf<number>()
    assert.equal(T.lift(Identity), Identity)
    const explicit = T.call(Identity, T.numberLiteral(1))
    expectTypeOf<T.Denotes<typeof explicit>>().toEqualTypeOf<number>()
    assert.equal(explicit.kind, "call")
    assert.equal(asNode(explicit.args[0]).kind, "literal")
    assert.equal(asNode(explicit.args[0]).value, 1)
    return explicit
  })
})

test("declared ref calls reject args of the wrong type", () => {
  T.build(function*() {
    const Classify = yield* fn("classify", {
      params: [T.param("score", T.Number)],
      returns: T.Number,
      body: function*({ score }) {
        return score
      },
    })
    T.call(Classify, 93)
    // @ts-expect-error - a string does not lift to Expr<number>
    T.call(Classify, "no")
    // @ts-expect-error - missing the score argument
    T.call(Classify)
    return T.call(Classify, 0)
  })
})

test("a generic function ref has to be instantiated before it is called", () => {
  const TParam = T.TypeParam("T")
  T.build(function*() {
    const Identity = yield* fn("identity", {
      typeParams: [TParam],
      params: [T.param("value", TParam)],
      returns: TParam,
      body: function*({ value }) {
        return value
      },
    })
    // @ts-expect-error - generics stay explicit: Instantiate first
    T.call(Identity, 1)
    const instantiated = T.instantiate(Identity, T.Number)
    assert.equal(instantiated.kind, "instantiation")
    return instantiated
  })
})

test("T.let and T.const define bindings with lifting", () => {
  const program = T.build(function*() {
    const x = yield* T.let("x", 1)
    expectTypeOf<T.Denotes<typeof x>>().toEqualTypeOf<number>()
    yield* T.assign(x, T.numberLiteral(2))
    const y = yield* T.const("y", 42)
    expectTypeOf<T.Denotes<typeof y>>().toEqualTypeOf<42>()
    return y
  })
  assert.equal(program.statements.length, 3)
  assert.equal(program.statements[0]!.kind, "let-declaration")
  assert.equal(asNode((program.statements[0] as T.BindingDeclaration).expr).value, 1)
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "const-declaration")
  assert.equal(asNode((program.statements[2] as T.BindingDeclaration).expr).value, 42)
})

test("T.assign lifts values and rejects readonly targets", () => {
  T.build(function*() {
    const grade = yield* T.let("grade", "F")
    yield* T.assign(grade, "A+")
    const obj = yield* T.let("obj", { count: 0 })
    yield* T.assign(T.prop(obj, "count"), 1)
    return grade
  })

  T.build(function*() {
    const obj = yield* T.let("obj", T.Object({ id: T.Readonly(T.Number), count: T.Number }))
    T.assign(T.prop(obj, "count"), 1)
    // @ts-expect-error - id is readonly
    T.assign(T.prop(obj, "id"), 2)
    const tuple = yield* T.let("tuple", T.Tuple(T.Number, T.String))
    T.assign(T.index(tuple, T.numberLiteral(0)), 1)
    T.assign(T.index(tuple, T.numberLiteral(1)), "one")
    // @ts-expect-error - tuple index 0 accepts only numbers
    T.assign(T.index(tuple, T.numberLiteral(0)), "zero")
    // @ts-expect-error - tuple index 1 accepts only strings
    T.assign(T.index(tuple, T.numberLiteral(1)), 1)
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    T.assign(T.index(tuple, T.numberLiteral(2)), 1)
    const readonlyArray = T.hostValue<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly array indexes are readonly
    T.assign(T.index(readonlyArray, T.numberLiteral(0)), 1)
    return obj
  })
})

test("T.forOf iterates arrays and strings", () => {
  const program = T.build(function*() {
    yield* T.forOf("item", [1, 2], function*(n) {
      expectTypeOf<T.Denotes<typeof n>>().toEqualTypeOf<number>()
    })
    yield* T.forOf("literal", [1, 2] as const, function*(n) {
      expectTypeOf<T.Denotes<typeof n>>().toEqualTypeOf<number>()
      assert.equal((n.type as T.Primitive).name, "number")
    })
    yield* T.forOf("char", "abc", function*(char) {
      expectTypeOf<T.Denotes<typeof char>>().toEqualTypeOf<string>()
    })
    // @ts-expect-error - cannot iterate a number
    T.forOf("n", 1, function*() {})
    return T.numberLiteral(0)
  })
  assert.deepEqual(program.statements.map((statement) => (statement as T.ForOfStatement).nameHint), ["item", "literal", "char"])
})

test("lifted arrays widen their elements, so bindings and loops agree with T.arrayLiteral", () => {
  T.build(function*() {
    const values = yield* T.const("values", [1, 2])
    expectTypeOf<T.Denotes<typeof values>>().toEqualTypeOf<number[]>()
    yield* T.forOf("n", values, function*(n) {
      expectTypeOf<T.Denotes<typeof n>>().toEqualTypeOf<number>()
    })
    return T.numberLiteral(0)
  })
})

test("type attachment: calls carry return type, binary nodes carry result type", () => {
  const sum = T.add(1, 2)
  assert.equal((sum.type as T.AnyType)?.kind, "primitive")
  assert.equal((sum.type as any)?.name, "number")

  const check = T.gte(1, 2)
  assert.equal((check.type as T.AnyType)?.kind, "primitive")
  assert.equal((check.type as any)?.name, "boolean")
})
