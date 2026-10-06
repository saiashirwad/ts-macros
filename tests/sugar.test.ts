import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { expectTypeOf } from "./typing.ts"

const fn = $.fn

type AnyNode = { readonly kind: string; readonly [key: string]: any }
const asNode = (x: any): AnyNode => $.lift(x as never) as unknown as AnyNode

interface Fs {
  readFileSync(path: string): string
}

test("lift lifts primitives to literal nodes, and says so in its type", () => {
  const n = $.lift(2)
  expectTypeOf<typeof n>().toEqualTypeOf<$.LiteralExpr<2>>()
  assert.equal(asNode(n).kind, "literal")
  assert.equal(asNode(n).value, 2)
  assert.equal((asNode(n).type as $.AnyType)?.kind, "literal")

  const s = $.lift("hi")
  expectTypeOf<typeof s>().toEqualTypeOf<$.LiteralExpr<"hi">>()
  assert.equal(asNode(s).value, "hi")
  assert.equal((asNode(s).type as $.AnyType)?.kind, "literal")

  const b = $.lift(true)
  expectTypeOf<typeof b>().toEqualTypeOf<$.LiteralExpr<true>>()
  assert.equal(asNode(b).value, true)
  assert.equal((asNode(b).type as $.AnyType)?.kind, "literal")
})

test("lift lifts arrays and plain objects recursively, preserving structure", () => {
  const arr = $.lift([1, "a"])
  expectTypeOf<$.Denotes<typeof arr>>().toEqualTypeOf<(string | number)[]>()
  assert.equal((asNode(arr).type as $.AnyType)?.kind, "array")
  const elements = asNode(arr).elements as AnyNode[]
  assert.deepEqual(elements.map((e) => e.kind), ["literal", "literal"])

  const obj = $.lift({ x: 1, nested: { s: "a" } })
  expectTypeOf<$.Denotes<typeof obj>>().toEqualTypeOf<{ x: number; nested: { s: string } }>()
  const fields = asNode(obj).fields as Record<string, AnyNode>
  assert.equal(fields["x"]!.kind, "literal")
  assert.equal(fields["nested"]!.kind, "object")
})

test("lift passes nodes through unchanged", () => {
  const node = $.number(2)
  assert.equal($.lift(node), node)
})

test("lift rejects unsupported objects and fields without invoking accessors", () => {
  assert.throws(() => $.lift((() => {}) as any), /cannot lift function/)
  assert.throws(() => $.lift(null as any), /cannot lift null/)
  assert.throws(() => $.lift(undefined as any), /cannot lift undefined/)
  assert.throws(() => $.lift(new Date() as any), /fields must be a plain object literal with Object\.prototype/)
  assert.throws(() => $.lift(Object.create(null) as any), /fields must be a plain object literal with Object\.prototype/)

  class RecordClass {
    value = 1
  }
  assert.throws(() => $.lift(new RecordClass() as any), /fields must be a plain object literal with Object\.prototype/)
  const badProto = Object.create({ foo: 1 })
  assert.throws(() => $.lift(badProto), /fields must be a plain object literal with Object\.prototype/)

  const symbol = Symbol("hidden")
  const symbolFields = { visible: 1, [symbol]: 2 }
  const rejectSymbolFields = () => {
    // @ts-expect-error - $.object cannot represent symbol-keyed fields
    $.lift(symbolFields)
  }
  void rejectSymbolFields
  assert.throws(() => $.lift(symbolFields as any), /fields must not have symbol keys/)

  const nonEnumerable = { visible: 1 }
  Object.defineProperty(nonEnumerable, "hidden", { value: 2, enumerable: false })
  assert.throws(() => $.lift(nonEnumerable), /field "hidden" must be enumerable/)

  let reads = 0
  const accessor = Object.defineProperty({ visible: 1 }, "computed", {
    enumerable: true,
    get() {
      reads++
      return 2
    },
  })
  assert.throws(() => $.lift(accessor), /field "computed" must be a data property, not an accessor/)
  assert.equal(reads, 0)
})

test("lift rejects unique symbol brands and accepts ordinary nested records", () => {
  const brand: unique symbol = Symbol("brand")
  type Branded = { value: number; [brand]: true }
  const branded: Branded = { value: 1, [brand]: true }
  expectTypeOf<$.Lift<Branded>>(undefined as never).toEqualTypeOf<never>()
  expectTypeOf<$.Lift<{ [key: symbol]: number }>>(undefined as never).toEqualTypeOf<never>()

  const rejectBranded = () => {
    // @ts-expect-error - unique symbol brands cannot be represented by $.object
    $.lift(branded)
  }
  void rejectBranded

  const ordinary = {
    user: { name: "Ada" as string, flags: { active: true as boolean } },
    count: 1 as number,
  }
  const lifted = $.lift(ordinary)
  expectTypeOf<$.Denotes<typeof lifted>>().toEqualTypeOf<typeof ordinary>()
  assert.equal(asNode(lifted).kind, "object")
})

test("call lifts its arguments and builds a Call node", () => {
  const fs = $.hostImport<Fs>("node:fs", "fs")
  const read = $.call($.prop(fs, "readFileSync"), "/tmp/a")
  expectTypeOf<$.Denotes<typeof read>>().toEqualTypeOf<string>()
  assert.equal(read.kind, "call")
  assert.equal(asNode(read.callee).key, "readFileSync")
  assert.equal(read.args.length, 1)
  assert.equal(asNode(read.args[0]).kind, "literal")
  assert.equal(asNode(read.args[0]).value, "/tmp/a")
})

test("call checks its arguments against the callee", () => {
  const floor = $.hostValue<(x: number) => number>("floor")
  $.call(floor, 1.5)
  $.call(floor, $.number(1.5))
  // @ts-expect-error - a string does not lift to Expr<number>
  $.call(floor, "no")
  // @ts-expect-error - missing the argument
  $.call(floor)
  // @ts-expect-error - a number is not callable
  $.call($.number(1))
})

test("call reaches the methods of a primitive", () => {
  const shout = $.call($.prop($.string("hi"), "toUpperCase"))
  expectTypeOf<$.Denotes<typeof shout>>().toEqualTypeOf<string>()
  assert.equal(asNode(shout.callee).key, "toUpperCase")
})

test("a plain object is not a node", () => {
  // @ts-expect-error - a node carries a brand only the constructors can give it
  const forged: $.Expr<number> = { kind: "literal", value: 1 }
  void forged
})

test("a plain function does not lift", () => {
  // @ts-expect-error - only values lift; a function would have to be a node
  assert.throws(() => $.add(() => 1, 1), /cannot lift function/)
})

test("operators build Binary nodes from mixed raw and node args", () => {
  const something = $.number(5)
  const sum = $.add(2, something)
  expectTypeOf<$.Denotes<typeof sum>>().toEqualTypeOf<number>()
  assert.equal(sum.kind, "binary")
  assert.equal(sum.op, "+")
  assert.equal(asNode(sum.left).kind, "literal")
  assert.equal(sum.right, something)

  assert.equal($.sub(1, 2).op, "-")
  assert.equal($.mul(1, 2).op, "*")
  assert.equal($.div(1, 2).op, "/")
  assert.equal($.mod(5, 2).op, "%")
  assert.equal($.eq(1, 1).op, "===")
  assert.equal($.neq(1, 1).op, "!==")
  assert.equal($.lt(1, 2).op, "<")
  assert.equal($.lte(1, 2).op, "<=")
  assert.equal($.gt(1, 2).op, ">")
  assert.equal($.gte(1, 2).op, ">=")
  assert.equal($.and(true, false).op, "&&")
  assert.equal($.or(true, false).op, "||")
})

test("operator result types flow from BinaryResult", () => {
  const str = $.add("a", 1)
  expectTypeOf<$.Denotes<typeof str>>().toEqualTypeOf<string>()
  const cmp = $.lt(1, 2)
  expectTypeOf<$.Denotes<typeof cmp>>().toEqualTypeOf<boolean>()
  const truthy = $.and($.boolean(true), 1)
  expectTypeOf<$.Denotes<typeof truthy>>().toEqualTypeOf<1>()
})

test("not and typeof build Unary nodes", () => {
  const negated = $.not($.boolean(true))
  expectTypeOf<$.Denotes<typeof negated>>().toEqualTypeOf<boolean>()
  assert.equal(negated.kind, "unary")
  assert.equal(negated.op, "!")
  assert.equal(asNode(negated.operand).kind, "literal")

  const t = $.typeof(2)
  expectTypeOf<$.Denotes<typeof t>>().toEqualTypeOf<
    "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
  >()
  assert.equal(t.op, "typeof")
})

test("a declared function is called with lifted arguments", () => {
  const program = $.build(function*() {
    const Classify = yield* fn("classify", {
      params: [$.param("score", $.Number)],
      returns: $.Number,
      body: function*({ score }) {
        return score
      },
    })

    const label = yield* $.const("label", $.call(Classify, 93))
    expectTypeOf<$.Denotes<typeof label>>().toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const built = asNode((program.statements[1] as $.BindingDeclaration).expr)
  assert.equal(built.kind, "call")
  const callee = asNode(built.callee)
  assert.equal(callee.kind, "ref")
  assert.equal(callee.nameHint, "classify")
  assert.equal(asNode(built.args[0]).value, 93)
})

test("declared refs still work as plain nodes: explicit Call, Denotes, and lift passthrough", () => {
  $.build(function*() {
    const Identity = yield* fn("identity", {
      params: [$.param("value", $.Number)],
      returns: $.Number,
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof Identity>>>().toEqualTypeOf<number>()
    assert.equal($.lift(Identity), Identity)
    const explicit = $.call(Identity, $.number(1))
    expectTypeOf<$.Denotes<typeof explicit>>().toEqualTypeOf<number>()
    assert.equal(explicit.kind, "call")
    assert.equal(asNode(explicit.args[0]).kind, "literal")
    assert.equal(asNode(explicit.args[0]).value, 1)
    return explicit
  })
})

test("declared ref calls reject args of the wrong type", () => {
  $.build(function*() {
    const Classify = yield* fn("classify", {
      params: [$.param("score", $.Number)],
      returns: $.Number,
      body: function*({ score }) {
        return score
      },
    })
    $.call(Classify, 93)
    // @ts-expect-error - a string does not lift to Expr<number>
    $.call(Classify, "no")
    // @ts-expect-error - missing the score argument
    $.call(Classify)
    return $.call(Classify, 0)
  })
})

test("a generic function ref has to be instantiated before it is called", () => {
  const T = $.TypeParam("T")
  $.build(function*() {
    const Identity = yield* fn("identity", {
      typeParams: [T],
      params: [$.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    // @ts-expect-error - generics stay explicit: Instantiate first
    $.call(Identity, 1)
    const instantiated = $.instantiate(Identity, $.Number)
    assert.equal(instantiated.kind, "instantiation")
    return instantiated
  })
})

test("$.let and $.const define bindings with lifting", () => {
  const program = $.build(function*() {
    const x = yield* $.let("x", 1)
    expectTypeOf<$.Denotes<typeof x>>().toEqualTypeOf<number>()
    yield* $.assign(x, $.number(2))
    const y = yield* $.const("y", 42)
    expectTypeOf<$.Denotes<typeof y>>().toEqualTypeOf<42>()
    return y
  })
  assert.equal(program.statements.length, 3)
  assert.equal(program.statements[0]!.kind, "let-declaration")
  assert.equal(asNode((program.statements[0] as $.BindingDeclaration).expr).value, 1)
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "const-declaration")
  assert.equal(asNode((program.statements[2] as $.BindingDeclaration).expr).value, 42)
})

test("$.assign lifts values and rejects readonly targets", () => {
  $.build(function*() {
    const grade = yield* $.let("grade", "F")
    yield* $.assign(grade, "A+")
    const obj = yield* $.let("obj", { count: 0 })
    yield* $.assign($.prop(obj, "count"), 1)
    return grade
  })

  $.build(function*() {
    const obj = yield* $.let("obj", $.Object({ id: $.Readonly($.Number), count: $.Number }))
    $.assign($.prop(obj, "count"), 1)
    // @ts-expect-error - id is readonly
    $.assign($.prop(obj, "id"), 2)
    const tuple = yield* $.let("tuple", $.Tuple($.Number, $.String))
    $.assign($.index(tuple, $.number(0)), 1)
    $.assign($.index(tuple, $.number(1)), "one")
    // @ts-expect-error - tuple index 0 accepts only numbers
    $.assign($.index(tuple, $.number(0)), "zero")
    // @ts-expect-error - tuple index 1 accepts only strings
    $.assign($.index(tuple, $.number(1)), 1)
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    $.assign($.index(tuple, $.number(2)), 1)
    const readonlyArray = $.hostValue<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly array indexes are readonly
    $.assign($.index(readonlyArray, $.number(0)), 1)
    return obj
  })
})

test("$.forOf iterates arrays and strings", () => {
  const program = $.build(function*() {
    yield* $.forOf("item", [1, 2], function*(n) {
      expectTypeOf<$.Denotes<typeof n>>().toEqualTypeOf<number>()
    })
    yield* $.forOf("literal", [1, 2] as const, function*(n) {
      expectTypeOf<$.Denotes<typeof n>>().toEqualTypeOf<number>()
      assert.equal((n.type as $.Primitive).name, "number")
    })
    yield* $.forOf("char", "abc", function*(char) {
      expectTypeOf<$.Denotes<typeof char>>().toEqualTypeOf<string>()
    })
    // @ts-expect-error - cannot iterate a number
    $.forOf("n", 1, function*() {})
    return $.number(0)
  })
  assert.deepEqual(program.statements.map((statement) => (statement as $.ForOfStatement).nameHint), ["item", "literal", "char"])
})

test("lifted arrays widen their elements, so bindings and loops agree with $.array", () => {
  $.build(function*() {
    const values = yield* $.const("values", [1, 2])
    expectTypeOf<$.Denotes<typeof values>>().toEqualTypeOf<number[]>()
    yield* $.forOf("n", values, function*(n) {
      expectTypeOf<$.Denotes<typeof n>>().toEqualTypeOf<number>()
    })
    return $.number(0)
  })
})

test("type attachment: calls carry return type, binary nodes carry result type", () => {
  const sum = $.add(1, 2)
  assert.equal((sum.type as $.AnyType)?.kind, "primitive")
  assert.equal((sum.type as any)?.name, "number")

  const check = $.gte(1, 2)
  assert.equal((check.type as $.AnyType)?.kind, "primitive")
  assert.equal((check.type as any)?.name, "boolean")
})
