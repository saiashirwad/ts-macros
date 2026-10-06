import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { lub, sameType, substitute, widen } from "../src/types/algebra.ts"
import { elementType, propType } from "../src/typing.ts"
import { typeChildren } from "../src/walk.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

const fn = $.fn

const spell = (body: $.Type<any>, params: $.AnyTypeParams = []): string => {
  const program = $.build(function*() {
    yield* $.type("T", { params, body })
    return null
  })
  return emitProgram(program).replace(/^type T(?:_\d+)?(<[^>]*>)? = /, "").replace(/;$/, "")
}

test("literal types reject non-finite numbers", () => {
  $.Literal(-0)
  $.Literal(1.5)

  assert.throws(() => $.Literal(NaN), /literal number must be finite, got NaN/)
  assert.throws(() => $.Literal(Infinity), /literal number must be finite, got Infinity/)
  assert.throws(() => $.Literal(-Infinity), /literal number must be finite, got -Infinity/)
})

test("type operators emit the TypeScript you would write by hand", () => {
  const T = $.TypeParam("T")
  const K = $.TypeParam("K")
  const obj = $.Object({ a: $.Number, b: $.String })

  assert.equal(spell($.KeyOf(obj)), "keyof { a: number; b: string }")
  assert.equal(spell($.IndexedAccess(obj, $.Literal("a"))), "{ a: number; b: string }[\"a\"]")
  assert.equal(spell($.Intersection(obj, $.Object({ c: $.Boolean }))), "{ a: number; b: string } & { c: boolean }")
  assert.equal(spell($.Conditional(T, $.String, $.Literal(true), $.Literal(false)), [T]), "T extends string ? true : false")
  assert.equal(spell($.Mapped("K", T, $.IndexedAccess(T, K)), [T]), "{ [K in keyof T]: T[K] }")
  assert.equal(spell($.Template(["id-", ""], $.Number)), "`id-${number}`")
  assert.equal(
    spell($.Conditional(T, $.Array($.Infer("E")), $.TypeParam("E"), $.Never), [T]),
    "T extends (infer E)[] ? E : never",
  )
})

test("the text emitter parenthesizes types by precedence", () => {
  assert.equal(spell($.Array($.Union($.String, $.Number))), "(string | number)[]")
  assert.equal(spell($.Array($.Number)), "number[]")
  assert.equal(spell($.Union($.Function([], $.Number), $.String)), "(() => number) | string")
  assert.equal(spell($.Union($.Intersection($.String, $.Number), $.Boolean)), "string & number | boolean")
  assert.equal(spell($.KeyOf($.Union($.String, $.Number))), "keyof (string | number)")
})

test("readonly arrays preserve their modifier throughout the type algebra", () => {
  const items = $.ReadonlyArray($.Literal("yes"))
  const mutable = $.Array($.Literal("yes"))
  const T = $.TypeParam("T")
  const symbolic = $.ReadonlyArray(T)
  assertType<Equal<$.TypeDenotes<typeof items>, readonly "yes"[]>>()
  assertType<Equal<$.Substitute<$.TypeDenotes<typeof symbolic>, [typeof T], [number]>, readonly number[]>>()
  assert.equal(spell(items), "readonly \"yes\"[]")
  assert.equal(spell($.ReadonlyArray($.Union($.String, $.Number))), "readonly (string | number)[]")
  assert.equal(spell($.Array($.ReadonlyArray($.Number))), "(readonly number[])[]")
  assert.equal(spell($.ReadonlyArray($.Array($.Number))), "readonly (number[])[]")
  assert.equal(spell($.KeyOf(items)), "keyof readonly \"yes\"[]")
  assert.equal(spell($.IndexedAccess(items, $.Number)), "(readonly \"yes\"[])[number]")
  assert.equal(spell($.Function([], $.Void, $.ReadonlyArray($.Number))), "(...arg0: readonly number[]) => void")
  assert.equal(sameType(items, mutable), false)
  assert.equal(sameType(items, $.ReadonlyArray($.Literal("yes"))), true)
  assert.equal((lub([items, mutable]) as $.Union).members.length, 2)
  assert.ok(sameType(widen(items), $.ReadonlyArray($.String)))
  assert.ok(sameType(substitute(symbolic, [T], [$.Number]), $.ReadonlyArray($.Number)))
  assert.deepEqual(typeChildren(items), [items.element])
  assert.equal(elementType(items), items.element)
  assert.ok(sameType(elementType($.Union(items, $.Array($.Number)))!, $.Union($.Literal("yes"), $.Number)))
  assert.ok(sameType(elementType($.Tuple($.Number, $.String))!, $.Union($.Number, $.String)))
})

test("function types accept array, tuple, and constrained symbolic rest types", () => {
  const arrayFn = $.Function([$.String], $.Void, $.Array($.Number))
  assert.equal(spell(arrayFn), "(arg0: string, ...arg1: number[]) => void")
  expectTypeOf<$.TypeDenotes<typeof arrayFn>>().toEqualTypeOf<(arg0: string, ...rest: number[]) => void>()

  const tupleFn = $.Function([], $.Void, $.Tuple($.String, $.Number))
  assert.equal(spell(tupleFn), "(...arg0: [string, number]) => void")
  expectTypeOf<$.TypeDenotes<typeof tupleFn>>().toEqualTypeOf<(...rest: [string, number]) => void>()

  const constrainedArray = $.TypeParam("A", $.Array($.Unknown))
  const arrayGeneric = $.Function([], $.Void, constrainedArray)
  assert.equal(spell(arrayGeneric, [constrainedArray]), "(...arg0: A) => void")

  const constrainedTuple = $.TypeParam("T", $.Tuple($.String, $.Number))
  const tupleGeneric = $.Function([], $.Void, constrainedTuple)
  assert.equal(spell(tupleGeneric, [constrainedTuple]), "(...arg0: T) => void")
  assert.equal(
    emitProgram($.build(function*() {
      yield* $.type("RestFunction", { params: [constrainedTuple], body: tupleGeneric })
      return null
    })),
    "type RestFunction<T extends [string, number]> = (...arg0: T) => void;",
  )

  const readonlyArray = $.hostType<readonly string[]>("ReadonlyArray", $.String)
  $.Function([], $.Void, readonlyArray)
  const readonlyTuple = $.hostType<readonly [string, number]>("ReadonlyPair")
  $.Function([], $.Void, readonlyTuple)
  const anyFn = $.Function([], $.Void, $.Any)
  assert.equal(spell(anyFn), "(...arg0: any) => void")

  // @ts-expect-error - a primitive cannot be used as a function rest type
  $.Function([], $.Void, $.Number)
  // @ts-expect-error - an object cannot be used as a function rest type
  $.Function([], $.Void, $.Object({ value: $.Number }))
  // @ts-expect-error - an unconstrained symbolic type is not proven array-like
  $.Function([], $.Void, $.TypeParam("R"))
  // @ts-expect-error - a symbolic type constrained to a primitive is not array-like
  $.Function([], $.Void, $.TypeParam("R", $.Number))
  // @ts-expect-error - TypeScript does not allow `T extends any` as a rest type
  $.Function([], $.Void, $.TypeParam("R", $.Any))
})

test("a declared rest parameter shows up in the inferred signature", () => {
  const program = $.build(function*() {
    yield* fn("sum", {
      params: [$.param("first", $.Number), $.rest("more", $.Number)],
      body: function*({ first }) {
        return first
      },
    })
    return null
  })
  const signature = (program.statements[0] as $.BuiltFunction).type as $.Function
  assert.equal(signature.params.length, 1)
  assert.equal((signature.rest as $.AnyType).kind, "array")
  assert.match(emitProgram(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
})

test("object field modifiers show up on the phantom and in emit", () => {
  const obj = $.Object({
    id: $.Readonly($.Number),
    nick: $.Optional($.String),
    both: $.Readonly($.Optional($.Boolean)),
    name: $.String,
  })
  expectTypeOf<$.TypeDenotes<typeof obj>>().toEqualTypeOf<
    { readonly id: number; nick?: string; readonly both?: boolean; name: string }
  >()

  assert.equal(spell(obj), "{ readonly id: number; nick?: string; readonly both?: boolean; name: string }")

  const program = $.build(function*() {
    yield* $.let("record", $.object({ id: $.number(1) }), $.Object({ id: $.Readonly($.Number) }))
    return null
  })
  assert.equal(emitProgram(program), "let record: { readonly id: number } = { id: 1 };")
})

test("a type alias body receives its params by name, constraints included", () => {
  const T = $.TypeParam("T", $.String)
  let seen!: typeof T
  const program = $.build(function*() {
    const Box = yield* $.type("Box", {
      params: [T],
      body: ({ T: got }) => {
        seen = got
        expectTypeOf<$.TypeDenotes<typeof got>>().toEqualTypeOf<$.Variable<"T"> & string>()
        return $.Object({ value: got })
      },
    })
    const applied = $.Apply(Box, [$.Literal("ok")])
    expectTypeOf<$.TypeDenotes<typeof applied>>().toEqualTypeOf<{ value: "ok" }>()
    // @ts-expect-error - T must extend string
    $.Apply(Box, [$.Number])

    const Pair = yield* $.type("Pair", {
      params: [T, $.TypeParam("U", T)],
      body: ({ T: got, U }) => {
        expectTypeOf<$.TypeDenotes<typeof U>>().toEqualTypeOf<$.Variable<"U"> & $.Variable<"T"> & string>()
        return $.Tuple(got, U)
      },
    })
    $.Apply(Pair, [$.String, $.Literal("ok")])
    // @ts-expect-error - U must extend the argument supplied for T
    $.Apply(Pair, [$.Literal("ok"), $.String])
    return Pair
  })
  assert.equal(seen, T)
  assert.equal(
    emitProgram(program),
    "type Box<T extends string> = { value: T };\ntype Pair<T extends string, U extends T> = [T, U];",
  )

  // @ts-expect-error - adjacent type parameters cannot have the same name
  $.type("Bad", { params: [T, $.TypeParam("T")], body: ({ T: got }) => got })
  // @ts-expect-error - a body can only name the params that were declared
  $.type("Box", { params: [T], body: ({ U }) => U ?? $.Never })
})

test("type parameter names are distinct", () => {
  const T = $.TypeParam("T")
  const U = $.TypeParam("U")
  const V = $.TypeParam("V")

  $.type("Pair", { params: [T, U], body: $.Tuple(T, U) })
  fn("pick", {
    typeParams: [T, U, V],
    body: function*() {
      return $.number(1)
    },
  })

  // @ts-expect-error - adjacent type parameters cannot have the same name
  $.type("Bad", { params: [T, $.TypeParam("T")], body: T })
  // @ts-expect-error - nonadjacent type parameters cannot have the same name
  $.type("Bad", { params: [T, U, $.TypeParam("T")], body: T })
  // @ts-expect-error - adjacent function type parameters cannot have the same name
  $.fn("bad", {
    typeParams: [T, $.TypeParam("T")],
    body: function*() {
      return $.number(1)
    },
  })
  // @ts-expect-error - nonadjacent function type parameters cannot have the same name
  $.fn("bad", {
    typeParams: [T, U, $.TypeParam("T")],
    body: function*() {
      return $.number(1)
    },
  })
})

test("a field modifier is not a type, so it compiles only as a field of an object type", () => {
  // @ts-expect-error - an element is a type
  $.Array($.Readonly($.Number))
  // @ts-expect-error - a union member is a type
  $.Union($.Optional($.Number), $.String)
  // @ts-expect-error - a param's type is a type
  $.param("p", $.Optional($.Number))
  // @ts-expect-error - a type alias's body is a type
  $.type("T", $.Readonly($.Number))
})

test("reading a field gives the field's type, without its modifiers", () => {
  const Rec = $.Object({ id: $.Readonly($.Number), nick: $.Optional($.String) })
  const program = $.build(function*() {
    yield* fn("getId", {
      params: [$.param("rec", Rec)],
      body: function*({ rec }) {
        return $.prop(rec, "id")
      },
    })
    yield* fn("getNick", {
      params: [$.param("rec", Rec)],
      body: function*({ rec }) {
        const nick = $.prop(rec, "nick")
        expectTypeOf<$.Denotes<typeof nick>>().toEqualTypeOf<any>()
        return nick
      },
    })
    return null
  })
  const returned = (statement: unknown): $.AnyType => ((statement as $.BuiltFunction).type as $.Function).return as $.AnyType
  const [getId, getNick] = program.statements
  assert.equal((returned(getId) as $.Primitive).name, "number")
  const nick = returned(getNick) as $.Union
  assert.deepEqual(nick.members.map((member) => (member as $.Primitive).name), ["string", "undefined"])
  assert.match(emitProgram(program), /function getId\(rec: \{ readonly id: number; nick\?: string \}\) \{/)
})

test("template literal types accept TypeScript's interpolation primitives", () => {
  const primitives = $.Template(
    ["s:", ",n:", ",b:", ",bool:", ",null:", ",undefined:", ""],
    $.Literal("x"),
    $.Literal(1),
    $.hostType<2n>("Big"),
    $.Literal(true),
    $.Null,
    $.Undefined,
  )
  expectTypeOf<$.TypeDenotes<typeof primitives>>().toEqualTypeOf<"s:x,n:1,b:2,bool:true,null:null,undefined:undefined">()
  assert.equal(spell(primitives), "`s:${\"x\"},n:${1},b:${Big},bool:${true},null:${null},undefined:${undefined}`")

  const crossProduct = $.Template(
    ["", "-", ""],
    $.Union($.Literal("a"), $.Literal("b")),
    $.Union($.Literal(1), $.Literal(2)),
  )
  expectTypeOf<$.TypeDenotes<typeof crossProduct>>().toEqualTypeOf<"a-1" | "a-2" | "b-1" | "b-2">()
  assert.equal(spell(crossProduct), "`${\"a\" | \"b\"}-${1 | 2}`")

  const T = $.TypeParam("T", $.Union($.String, $.Number))
  const symbolic = $.Template(["value-", ""], T)
  expectTypeOf<$.Abstract<$.TypeDenotes<typeof symbolic>>>().toEqualTypeOf<true>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof symbolic>, [typeof T], ["x" | 1]>>().toEqualTypeOf<"value-x" | "value-1">()
  assert.equal(spell(symbolic, [T]), "`value-${T}`")
})

test("template literal types check their arity and interpolation types", () => {
  assert.throws(() => $.Template(["a", "b", "c"], $.Literal(1)), /needs 2 parts, got 3/)
  $.Template(["", ""], $.TypeParam("Text", $.String))
  $.Template(["", ""], $.TypeParam("Anything", $.Any))
  const Nothing = $.TypeParam("Nothing", $.Never)
  $.Template(["", ""], Nothing)
  $.Template(["", ""], $.hostType<string | number>("StringOrNumber"))
  const Base = $.TypeParam("Base", $.String)
  $.Template(["", ""], $.TypeParam("Dependent", Base))
  // @ts-expect-error - an unconstrained type parameter is not proven interpolable
  $.Template(["", ""], $.TypeParam("T"))
  // @ts-expect-error - an unknown constraint is not proven interpolable
  $.Template(["", ""], $.TypeParam("T", $.Unknown))
  // @ts-expect-error - an object constraint is not interpolable
  $.Template(["", ""], $.TypeParam("T", $.Object({ value: $.Number })))
  // @ts-expect-error - object types cannot be template literal interpolations
  $.Template(["", ""], $.Object({ value: $.Number }))
  // @ts-expect-error - object reference phantoms cannot be template literal interpolations
  $.Template(["", ""], $.hostType<{ value: number }>("RecordType"))
  // @ts-expect-error - symbol cannot be a template literal interpolation
  $.Template(["", ""], $.hostType<symbol>("SymbolType"))
})

test("operators over concrete types denote the evaluated type", () => {
  const obj = $.Object({ name: $.String, age: $.Number })
  expectTypeOf<$.TypeDenotes<$.KeyOf<typeof obj>>>().toEqualTypeOf<"name" | "age">()
  expectTypeOf<$.TypeDenotes<$.IndexedAccess<typeof obj, $.Literal<"age">>>>().toEqualTypeOf<number>()
  const literal = $.Template(["hello-", ""], $.Literal("world"))
  expectTypeOf<$.TypeDenotes<typeof literal>>().toEqualTypeOf<"hello-world">()
  const cond = $.Conditional($.String, $.String, $.Literal(1), $.Literal(2))
  expectTypeOf<$.TypeDenotes<typeof cond>>().toEqualTypeOf<1>()
  const concreteUnion = $.Conditional($.Union($.String, $.Number), $.String, $.Literal(1), $.Literal(2))
  expectTypeOf<$.TypeDenotes<typeof concreteUnion>>().toEqualTypeOf<2>()
})

test("mapped substitution keeps positional args aligned when its key shadows a param", () => {
  const key = $.TypeParam("K")
  const source = $.TypeParam("S")
  const value = $.TypeParam("V")
  const body = $.Object({ source, value })

  const keyFirst = substitute(
    $.Mapped("K", source, body),
    [key, source, value],
    [$.Literal("shadowed"), $.String, $.Number],
  ) as $.Mapped
  assert.equal((keyFirst.source as $.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyFirst.body as $.Object).fields).map(([name, field]) => [name, ($.fieldOf(field).type as $.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )

  const keyMiddle = substitute(
    $.Mapped("K", source, body),
    [source, key, value],
    [$.String, $.Literal("shadowed"), $.Number],
  ) as $.Mapped
  assert.equal((keyMiddle.source as $.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyMiddle.body as $.Object).fields).map(([name, field]) => [name, ($.fieldOf(field).type as $.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )
})

test("logical operators stay symbolic and reduce after substitution", () => {
  type And = $.LogicalDenote<"and", $.Variable<"T">, "right">
  type Or = $.LogicalDenote<"or", $.Variable<"T">, "right">
  expectTypeOf<And>().toEqualTypeOf<$.Op<"and", [$.Variable<"T">, "right"]>>()
  expectTypeOf<$.Substitute<And, [$.TypeParam<"T", any>], [false]>>().toEqualTypeOf<false>()
  expectTypeOf<$.Substitute<And, [$.TypeParam<"T", any>], [true]>>().toEqualTypeOf<"right">()
  expectTypeOf<$.Substitute<Or, [$.TypeParam<"T", any>], [unknown]>>().toEqualTypeOf<{}>()
  type AndNever = $.LogicalDenote<"and", never, "right">
  type OrNever = $.LogicalDenote<"or", never, "right">
  expectTypeOf<Equal<AndNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<OrNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<$.LogicalDenote<"and", unknown, "right">, unknown>>().toEqualTypeOf<true>()
  expectTypeOf<$.LogicalDenote<"or", unknown, "right">>().toEqualTypeOf<{}>()
  expectTypeOf<$.LogicalDenote<"and", number, "right">>().toEqualTypeOf<0 | "right">()
  expectTypeOf<$.LogicalDenote<"or", number, "right">>().toEqualTypeOf<number | "right">()
})

test("Substitute reduces symbolic operators once generic args arrive", () => {
  type CondBody = $.Op<"cond", [$.Variable<"T">, string, $.Variable<"T">, never]>
  expectTypeOf<$.Substitute<CondBody, [$.TypeParam<"T", any>], [string]>>().toEqualTypeOf<string>()
  type SubNull = $.Substitute<CondBody, [$.TypeParam<"T", any>], [null]>
  expectTypeOf<Equal<SubNull, never>>().toEqualTypeOf<true>()

  type IndexBody = $.Op<"index", [{ name: string; age: number }, $.Variable<"K">]>
  expectTypeOf<$.Substitute<IndexBody, [$.TypeParam<"K", any>], ["name"]>>().toEqualTypeOf<string>()

  type MappedBody = $.Op<"mapped", [{ a: string; b: number }, $.Op<"index", [{ a: string; b: number }, $.Variable<"K">]>, "K"]>
  expectTypeOf<$.Substitute<MappedBody, [], []>>().toEqualTypeOf<{ a: string; b: number }>()
})

test("conditional AST substitution preserves naked and wrapped checks", () => {
  const T = $.TypeParam("T")
  const concrete = $.Conditional($.Union($.String, $.Number), $.String, $.Literal(1), $.Literal(2))
  const concreteResult = substitute(concrete, [], []) as $.Conditional
  assert.equal(concreteResult.kind, "conditional")
  assert.equal((concreteResult.check as $.Union).members.length, 2)

  const naked = $.Conditional(T, $.String, $.Literal(1), $.Literal(2))
  const nakedResult = substitute(naked, [T], [$.Union($.String, $.Number)]) as $.Conditional
  assert.equal(nakedResult.kind, "conditional")
  assert.equal((nakedResult.check as $.Union).members.length, 2)

  const wrapped = $.Conditional($.Tuple(T), $.Tuple($.String), $.Literal(1), $.Literal(2))
  const wrappedResult = substitute(wrapped, [T], [$.Union($.String, $.Number)]) as $.Conditional
  assert.equal(wrappedResult.kind, "conditional")
  assert.equal(((wrappedResult.check as $.Tuple).items[0] as $.Union).members.length, 2)
})

test("conditionals bind infer variables against the checked type", () => {
  const T = $.TypeParam("T")
  const U = $.TypeParam("U")
  const Unwrap = $.Conditional(T, $.Promise($.Infer("U")), U, T)
  const params = [T] as const

  expectTypeOf<$.Substitute<$.TypeDenotes<typeof Unwrap>, [typeof T], [Promise<number>]>>().toEqualTypeOf<number>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof Unwrap>, [typeof T], [string]>>().toEqualTypeOf<string>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof Unwrap>, [typeof T], [Promise<number> | boolean]>>().toEqualTypeOf<number | boolean>()

  const field = $.Conditional(T, $.Object({ value: $.Infer("V") }), $.TypeParam("V"), $.Never)
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof field>, [typeof T], [{ value: boolean; other: 1 }]>>().toEqualTypeOf<boolean>()
  expectTypeOf<Equal<$.Substitute<$.TypeDenotes<typeof field>, [typeof T], [string]>, never>>().toEqualTypeOf<true>()

  const pair = $.Conditional(T, $.Tuple($.Infer("A"), $.Infer("B")), $.Tuple($.TypeParam("B"), $.TypeParam("A")), $.Never)
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof pair>, [typeof T], [[1, "x"]]>>().toEqualTypeOf<["x", 1]>()

  const element = $.Conditional(T, $.Array($.Infer("E")), $.TypeParam("E"), T)
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof element>, [typeof T], [string[]]>>().toEqualTypeOf<string>()

  const wrapped = $.Conditional($.Tuple(T), $.Tuple($.String), $.Literal(true), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof wrapped>, [typeof T], [string | number]>>().toEqualTypeOf<false>()

  const concreteInfer = $.Conditional(
    $.Union($.Promise($.Number), $.Boolean),
    $.Promise($.Infer("U")),
    $.TypeParam("U"),
    $.Literal(false),
  )
  expectTypeOf<$.TypeDenotes<typeof concreteInfer>>().toEqualTypeOf<false>()

  const objectInfer = $.Conditional(T, $.Object({ x: $.Infer("U") }), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof objectInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()
  const tupleInfer = $.Conditional(T, $.Tuple($.Infer("U")), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof tupleInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown>()
  const functionInfer = $.Conditional(T, $.Function([$.Infer("U")], $.Any), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof functionInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown>()
  const returnInfer = $.Conditional(T, $.Function([], $.Infer("U"), $.Any), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof returnInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()
  const promiseInfer = $.Conditional(T, $.Promise($.Infer("U")), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof promiseInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()

  const ordinaryAny = $.Conditional(T, $.String, $.Literal(true), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof ordinaryAny>, [typeof T], [any]>>().toEqualTypeOf<true | false>()

  const repeatedTuple = $.Conditional(T, $.Tuple($.Infer("U"), $.Infer("U")), $.TypeParam("U"), $.Literal(false))
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof repeatedTuple>, [typeof T], [[string, number]]>>().toEqualTypeOf<string | number>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof repeatedTuple>, [typeof T], [any]>>().toEqualTypeOf<unknown>()

  const repeatedObject = $.Conditional(
    T,
    $.Object({ a: $.Infer("U"), b: $.Infer("U") }),
    $.TypeParam("U"),
    $.Literal(false),
  )
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof repeatedObject>, [typeof T], [{ a: string; b: number }]>>()
    .toEqualTypeOf<string | number>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof repeatedObject>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()

  const repeatedFunction = $.Conditional(
    T,
    $.Function([$.Infer("U"), $.Infer("U")], $.Void),
    $.TypeParam("U"),
    $.Literal(false),
  )
  type RepeatedFunctionResult = $.Substitute<$.TypeDenotes<typeof repeatedFunction>, [typeof T], [(a: string, b: number) => void]>
  expectTypeOf<Equal<RepeatedFunctionResult, never>>().toEqualTypeOf<true>()
  expectTypeOf<$.Substitute<$.TypeDenotes<typeof repeatedFunction>, [typeof T], [any]>>().toEqualTypeOf<unknown>()

  const nestedFunction = $.Conditional(
    T,
    $.Function(
      [$.Function([$.Infer("U")], $.Void), $.Function([$.Infer("U")], $.Void)],
      $.Void,
    ),
    $.TypeParam("U"),
    $.Literal(false),
  )
  expectTypeOf<
    $.Substitute<$.TypeDenotes<typeof nestedFunction>, [typeof T], [(a: (x: string) => void, b: (x: number) => void) => void]>
  >().toEqualTypeOf<string | number>()

  const mixedVariance = $.Conditional(
    T,
    $.Object({ value: $.Infer("U"), consume: $.Function([$.Infer("U")], $.Void) }),
    $.TypeParam("U"),
    $.Literal(false),
  )
  type MixedVarianceResult = $.Substitute<
    $.TypeDenotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: number) => void }]
  >
  const mixedConflict: MixedVarianceResult = false
  void mixedConflict
  type MixedSame = $.Substitute<
    $.TypeDenotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: string) => void }]
  >
  expectTypeOf<Equal<MixedSame, string>>().toEqualTypeOf<true>()
  type MixedCovariantSubtype = $.Substitute<
    $.TypeDenotes<typeof mixedVariance>,
    [typeof T],
    [{ value: "x"; consume: (x: string) => void }]
  >
  const mixedCovariantSubtype: MixedCovariantSubtype = "x"
  void mixedCovariantSubtype
  type MixedContravariantSubtype = $.Substitute<
    $.TypeDenotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: "x") => void }]
  >
  const mixedContravariantSubtype: MixedContravariantSubtype = false
  void mixedContravariantSubtype

  expectTypeOf<$.Abstract<$.TypeDenotes<typeof Unwrap>>>().toEqualTypeOf<true>()
  void params
})

test("a declared generic with infer resolves when applied", () => {
  const T = $.TypeParam("T")
  let Resolved!: $.TypeRef<any>
  $.build(function*() {
    const Unwrap = yield* $.type("Unwrap", {
      params: [T],
      body: $.Conditional(T, $.Promise($.Infer("U")), $.TypeParam("U"), T),
    })
    const applied = $.Apply(Unwrap, [$.Promise($.Number)])
    expectTypeOf<$.TypeDenotes<typeof applied>>().toEqualTypeOf<number>()
    Resolved = yield* $.type("Resolved", applied)
    return null
  })
  assert.equal(Resolved.nameHint, "Resolved")
})

test("a host generic stays symbolic until its argument is concrete", () => {
  const T = $.TypeParam("T")
  $.build(function*() {
    const Wrap = yield* $.type("Wrap", { params: [T], body: $.Promise(T) })
    const applied = $.Apply(Wrap, [$.Number])
    expectTypeOf<$.TypeDenotes<typeof applied>>().toEqualTypeOf<Promise<number>>()
    const Twice = yield* $.type("Twice", { params: [T], body: $.Apply(Wrap, [$.Apply(Wrap, [T])]) })
    const twice = $.Apply(Twice, [$.String])
    expectTypeOf<$.TypeDenotes<typeof twice>>().toEqualTypeOf<Promise<Promise<string>>>()
    return null
  })
  expectTypeOf<$.Abstract<$.TypeDenotes<ReturnType<typeof $.Promise<typeof T>>>>>().toEqualTypeOf<true>()
})

test("Abstract only fires for unresolved symbolic information", () => {
  expectTypeOf<$.Abstract<[unknown, $.Variable<"T">]>>().toEqualTypeOf<true>()
  expectTypeOf<$.Abstract<{ a: unknown; b: $.Variable<"T"> }>>().toEqualTypeOf<true>()
  expectTypeOf<$.Abstract<[unknown, string]>>().toEqualTypeOf<false>()
  expectTypeOf<$.Abstract<Promise<number>>>().toEqualTypeOf<false>()
  expectTypeOf<$.Abstract<(x: $.Variable<"T">) => void>>().toEqualTypeOf<true>()
  expectTypeOf<$.Abstract<$.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<$.Abstract<string>>().toEqualTypeOf<false>()
  expectTypeOf<$.Abstract<{ a: string }>>().toEqualTypeOf<false>()
  expectTypeOf<$.Abstract<string | $.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<{ x: 1 } extends $.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends $.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends $.Variable<any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{ x: 1 } extends $.Op<any, any> ? true : false>().toEqualTypeOf<false>()
})

test("Instantiate substitutes through operator nodes at runtime", () => {
  const T = $.TypeParam("T")
  let instantiated!: $.Instantiation<any, any, any, any>
  $.build(function*() {
    const keys = yield* fn("keys", {
      typeParams: [T],
      params: [$.param("value", T)],
      returns: $.KeyOf(T),
      body: function*({ value }) {
        return value as never
      },
    })
    instantiated = $.instantiate(keys, $.Object({ a: $.Number }))
    return null
  })
  const signature = instantiated.type as $.Function
  const returned = signature.return as $.KeyOf
  assert.equal(returned.kind, "keyof")
  assert.equal((returned.operand as $.AnyType).kind, "object")
})

test("a type alias identity is declared once per program", () => {
  const alias = $.type("Id", $.String)
  assert.throws(
    () =>
      $.build(function*() {
        yield* alias
        yield* alias
        return null
      }),
    /declared more than once with the same identity/,
  )
})

test("a type reference must resolve to an in-scope alias", () => {
  const alias = $.build(function*() {
    return yield* $.type("Missing", $.String)
  }).result
  assert.throws(
    () =>
      $.build(function*() {
        yield* $.const("id", "a", alias)
        return null
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("a reference to a host type emits its name", () => {
  const Custom = $.hostType<{ readonly custom: true }>("MyCustomType")
  const program = $.build(function*() {
    yield* fn("process", {
      params: [$.param("x", Custom)],
      returns: Custom,
      body: function*({ x }) {
        return x
      },
    })
    return null
  })
  assert.match(emitProgram(program), /function process\(x: MyCustomType\): MyCustomType/)
})

test("property reads see through literal-key records and intersections", () => {
  const record = $.External("Record", $.Literal("name"), $.Unknown)
  assert.equal(propType(record, "name"), $.Unknown)
  assert.equal(propType(record, "other"), undefined)
  const object = $.Object({ name: $.String, count: $.Number })
  assert.equal(propType($.Intersection(object, record), "name"), $.String)
  assert.equal(propType($.Intersection(object, record), "count"), $.Number)
  assert.equal(propType($.Intersection($.Object({ id: $.Number }), record), "name"), $.Unknown)
  assert.equal(propType($.Intersection(object, $.Object({ name: $.Number })), "name"), undefined)
})
