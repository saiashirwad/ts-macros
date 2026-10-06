import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { lub, sameType, substitute, widen } from "../src/types/algebra.ts"
import { elementType, propType } from "../src/typing.ts"
import { typeChildren } from "../src/walk.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

const fn = T.fn

const spell = (body: T.Type<any>, params: T.AnyTypeParams = []): string => {
  const program = T.build(function*() {
    yield* T.type("T", { params, body })
    return null
  })
  return emitProgram(program).replace(/^type T(?:_\d+)?(<[^>]*>)? = /, "").replace(/;$/, "")
}

test("literal types reject non-finite numbers", () => {
  T.Literal(-0)
  T.Literal(1.5)

  assert.throws(() => T.Literal(NaN), /literal number must be finite, got NaN/)
  assert.throws(() => T.Literal(Infinity), /literal number must be finite, got Infinity/)
  assert.throws(() => T.Literal(-Infinity), /literal number must be finite, got -Infinity/)
})

test("type operators emit the TypeScript you would write by hand", () => {
  const TParam = T.TypeParam("T")
  const K = T.TypeParam("K")
  const obj = T.Object({ a: T.Number, b: T.String })

  assert.equal(spell(T.KeyOf(obj)), "keyof { a: number; b: string }")
  assert.equal(spell(T.IndexedAccess(obj, T.Literal("a"))), "{ a: number; b: string }[\"a\"]")
  assert.equal(spell(T.Intersection(obj, T.Object({ c: T.Boolean }))), "{ a: number; b: string } & { c: boolean }")
  assert.equal(spell(T.Conditional(TParam, T.String, T.Literal(true), T.Literal(false)), [TParam]), "T extends string ? true : false")
  assert.equal(spell(T.Mapped("K", TParam, T.IndexedAccess(TParam, K)), [TParam]), "{ [K in keyof T]: T[K] }")
  assert.equal(spell(T.Template(["id-", ""], T.Number)), "`id-${number}`")
  assert.equal(
    spell(T.Conditional(TParam, T.Array(T.Infer("E")), T.TypeParam("E"), T.Never), [TParam]),
    "T extends (infer E)[] ? E : never",
  )
})

test("the text emitter parenthesizes types by precedence", () => {
  assert.equal(spell(T.Array(T.Union(T.String, T.Number))), "(string | number)[]")
  assert.equal(spell(T.Array(T.Number)), "number[]")
  assert.equal(spell(T.Union(T.Function([], T.Number), T.String)), "(() => number) | string")
  assert.equal(spell(T.Union(T.Intersection(T.String, T.Number), T.Boolean)), "string & number | boolean")
  assert.equal(spell(T.KeyOf(T.Union(T.String, T.Number))), "keyof (string | number)")
})

test("readonly arrays preserve their modifier throughout the type algebra", () => {
  const items = T.ReadonlyArray(T.Literal("yes"))
  const mutable = T.Array(T.Literal("yes"))
  const TParam = T.TypeParam("T")
  const symbolic = T.ReadonlyArray(TParam)
  assertType<Equal<T.TypeDenotes<typeof items>, readonly "yes"[]>>()
  assertType<Equal<T.Substitute<T.TypeDenotes<typeof symbolic>, [typeof TParam], [number]>, readonly number[]>>()
  assert.equal(spell(items), "readonly \"yes\"[]")
  assert.equal(spell(T.ReadonlyArray(T.Union(T.String, T.Number))), "readonly (string | number)[]")
  assert.equal(spell(T.Array(T.ReadonlyArray(T.Number))), "(readonly number[])[]")
  assert.equal(spell(T.ReadonlyArray(T.Array(T.Number))), "readonly (number[])[]")
  assert.equal(spell(T.KeyOf(items)), "keyof readonly \"yes\"[]")
  assert.equal(spell(T.IndexedAccess(items, T.Number)), "(readonly \"yes\"[])[number]")
  assert.equal(spell(T.Function([], T.Void, T.ReadonlyArray(T.Number))), "(...arg0: readonly number[]) => void")
  assert.equal(sameType(items, mutable), false)
  assert.equal(sameType(items, T.ReadonlyArray(T.Literal("yes"))), true)
  assert.equal((lub([items, mutable]) as T.Union).members.length, 2)
  assert.ok(sameType(widen(items), T.ReadonlyArray(T.String)))
  assert.ok(sameType(substitute(symbolic, [TParam], [T.Number]), T.ReadonlyArray(T.Number)))
  assert.deepEqual(typeChildren(items), [items.element])
  assert.equal(elementType(items), items.element)
  assert.ok(sameType(elementType(T.Union(items, T.Array(T.Number)))!, T.Union(T.Literal("yes"), T.Number)))
  assert.ok(sameType(elementType(T.Tuple(T.Number, T.String))!, T.Union(T.Number, T.String)))
})

test("function types accept array, tuple, and constrained symbolic rest types", () => {
  const arrayFn = T.Function([T.String], T.Void, T.Array(T.Number))
  assert.equal(spell(arrayFn), "(arg0: string, ...arg1: number[]) => void")
  expectTypeOf<T.TypeDenotes<typeof arrayFn>>().toEqualTypeOf<(arg0: string, ...rest: number[]) => void>()

  const tupleFn = T.Function([], T.Void, T.Tuple(T.String, T.Number))
  assert.equal(spell(tupleFn), "(...arg0: [string, number]) => void")
  expectTypeOf<T.TypeDenotes<typeof tupleFn>>().toEqualTypeOf<(...rest: [string, number]) => void>()

  const constrainedArray = T.TypeParam("A", T.Array(T.Unknown))
  const arrayGeneric = T.Function([], T.Void, constrainedArray)
  assert.equal(spell(arrayGeneric, [constrainedArray]), "(...arg0: A) => void")

  const constrainedTuple = T.TypeParam("T", T.Tuple(T.String, T.Number))
  const tupleGeneric = T.Function([], T.Void, constrainedTuple)
  assert.equal(spell(tupleGeneric, [constrainedTuple]), "(...arg0: T) => void")
  assert.equal(
    emitProgram(T.build(function*() {
      yield* T.type("RestFunction", { params: [constrainedTuple], body: tupleGeneric })
      return null
    })),
    "type RestFunction<T extends [string, number]> = (...arg0: T) => void;",
  )

  const readonlyArray = T.hostType<readonly string[]>("ReadonlyArray", T.String)
  T.Function([], T.Void, readonlyArray)
  const readonlyTuple = T.hostType<readonly [string, number]>("ReadonlyPair")
  T.Function([], T.Void, readonlyTuple)
  const anyFn = T.Function([], T.Void, T.Any)
  assert.equal(spell(anyFn), "(...arg0: any) => void")

  // @ts-expect-error - a primitive cannot be used as a function rest type
  T.Function([], T.Void, T.Number)
  // @ts-expect-error - an object cannot be used as a function rest type
  T.Function([], T.Void, T.Object({ value: T.Number }))
  // @ts-expect-error - an unconstrained symbolic type is not proven array-like
  T.Function([], T.Void, T.TypeParam("R"))
  // @ts-expect-error - a symbolic type constrained to a primitive is not array-like
  T.Function([], T.Void, T.TypeParam("R", T.Number))
  // @ts-expect-error - TypeScript does not allow `T extends any` as a rest type
  T.Function([], T.Void, T.TypeParam("R", T.Any))
})

test("a declared rest parameter shows up in the inferred signature", () => {
  const program = T.build(function*() {
    yield* fn("sum", {
      params: [T.param("first", T.Number), T.rest("more", T.Number)],
      body: function*({ first }) {
        return first
      },
    })
    return null
  })
  const signature = (program.statements[0] as T.BuiltFunction).type as T.FunctionType
  assert.equal(signature.params.length, 1)
  assert.equal((signature.rest as T.AnyType).kind, "array")
  assert.match(emitProgram(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
})

test("object field modifiers show up on the phantom and in emit", () => {
  const obj = T.Object({
    id: T.Readonly(T.Number),
    nick: T.Optional(T.String),
    both: T.Readonly(T.Optional(T.Boolean)),
    name: T.String,
  })
  expectTypeOf<T.TypeDenotes<typeof obj>>().toEqualTypeOf<
    { readonly id: number; nick?: string; readonly both?: boolean; name: string }
  >()

  assert.equal(spell(obj), "{ readonly id: number; nick?: string; readonly both?: boolean; name: string }")

  const program = T.build(function*() {
    yield* T.let("record", T.objectLiteral({ id: T.numberLiteral(1) }), T.Object({ id: T.Readonly(T.Number) }))
    return null
  })
  assert.equal(emitProgram(program), "let record: { readonly id: number } = { id: 1 };")
})

test("a type alias body receives its params by name, constraints included", () => {
  const TParam = T.TypeParam("T", T.String)
  let seen!: typeof TParam
  const program = T.build(function*() {
    const Box = yield* T.type("Box", {
      params: [TParam],
      body: ({ T: got }) => {
        seen = got
        expectTypeOf<T.TypeDenotes<typeof got>>().toEqualTypeOf<T.Variable<"T"> & string>()
        return T.Object({ value: got })
      },
    })
    const applied = T.Apply(Box, [T.Literal("ok")])
    expectTypeOf<T.TypeDenotes<typeof applied>>().toEqualTypeOf<{ value: "ok" }>()
    // @ts-expect-error - T must extend string
    T.Apply(Box, [T.Number])

    const Pair = yield* T.type("Pair", {
      params: [TParam, T.TypeParam("U", TParam)],
      body: ({ T: got, U }) => {
        expectTypeOf<T.TypeDenotes<typeof U>>().toEqualTypeOf<T.Variable<"U"> & T.Variable<"T"> & string>()
        return T.Tuple(got, U)
      },
    })
    T.Apply(Pair, [T.String, T.Literal("ok")])
    // @ts-expect-error - U must extend the argument supplied for T
    T.Apply(Pair, [T.Literal("ok"), T.String])
    return Pair
  })
  assert.equal(seen, TParam)
  assert.equal(
    emitProgram(program),
    "type Box<T extends string> = { value: T };\ntype Pair<T extends string, U extends T> = [T, U];",
  )

  // @ts-expect-error - adjacent type parameters cannot have the same name
  T.type("Bad", { params: [TParam, T.TypeParam("T")], body: ({ T: got }) => got })
  // @ts-expect-error - a body can only name the params that were declared
  T.type("Box", { params: [TParam], body: ({ U }) => U ?? T.Never })
})

test("type parameter names are distinct", () => {
  const TParam = T.TypeParam("T")
  const U = T.TypeParam("U")
  const V = T.TypeParam("V")

  T.type("Pair", { params: [TParam, U], body: T.Tuple(TParam, U) })
  fn("pick", {
    typeParams: [TParam, U, V],
    body: function*() {
      return T.numberLiteral(1)
    },
  })

  // @ts-expect-error - adjacent type parameters cannot have the same name
  T.type("Bad", { params: [TParam, T.TypeParam("T")], body: TParam })
  // @ts-expect-error - nonadjacent type parameters cannot have the same name
  T.type("Bad", { params: [TParam, U, T.TypeParam("T")], body: TParam })
  // @ts-expect-error - adjacent function type parameters cannot have the same name
  T.fn("bad", {
    typeParams: [TParam, T.TypeParam("T")],
    body: function*() {
      return T.numberLiteral(1)
    },
  })
  // @ts-expect-error - nonadjacent function type parameters cannot have the same name
  T.fn("bad", {
    typeParams: [TParam, U, T.TypeParam("T")],
    body: function*() {
      return T.numberLiteral(1)
    },
  })
})

test("a field modifier is not a type, so it compiles only as a field of an object type", () => {
  // @ts-expect-error - an element is a type
  T.Array(T.Readonly(T.Number))
  // @ts-expect-error - a union member is a type
  T.Union(T.Optional(T.Number), T.String)
  // @ts-expect-error - a param's type is a type
  T.param("p", T.Optional(T.Number))
  // @ts-expect-error - a type alias's body is a type
  T.type("T", T.Readonly(T.Number))
})

test("reading a field gives the field's type, without its modifiers", () => {
  const Rec = T.Object({ id: T.Readonly(T.Number), nick: T.Optional(T.String) })
  const program = T.build(function*() {
    yield* fn("getId", {
      params: [T.param("rec", Rec)],
      body: function*({ rec }) {
        return T.prop(rec, "id")
      },
    })
    yield* fn("getNick", {
      params: [T.param("rec", Rec)],
      body: function*({ rec }) {
        const nick = T.prop(rec, "nick")
        expectTypeOf<T.Denotes<typeof nick>>().toEqualTypeOf<any>()
        return nick
      },
    })
    return null
  })
  const returned = (statement: unknown): T.AnyType => ((statement as T.BuiltFunction).type as T.FunctionType).return as T.AnyType
  const [getId, getNick] = program.statements
  assert.equal((returned(getId) as T.Primitive).name, "number")
  const nick = returned(getNick) as T.Union
  assert.deepEqual(nick.members.map((member) => (member as T.Primitive).name), ["string", "undefined"])
  assert.match(emitProgram(program), /function getId\(rec: \{ readonly id: number; nick\?: string \}\) \{/)
})

test("template literal types accept TypeScript's interpolation primitives", () => {
  const primitives = T.Template(
    ["s:", ",n:", ",b:", ",bool:", ",null:", ",undefined:", ""],
    T.Literal("x"),
    T.Literal(1),
    T.hostType<2n>("Big"),
    T.Literal(true),
    T.Null,
    T.Undefined,
  )
  expectTypeOf<T.TypeDenotes<typeof primitives>>().toEqualTypeOf<"s:x,n:1,b:2,bool:true,null:null,undefined:undefined">()
  assert.equal(spell(primitives), "`s:${\"x\"},n:${1},b:${Big},bool:${true},null:${null},undefined:${undefined}`")

  const crossProduct = T.Template(
    ["", "-", ""],
    T.Union(T.Literal("a"), T.Literal("b")),
    T.Union(T.Literal(1), T.Literal(2)),
  )
  expectTypeOf<T.TypeDenotes<typeof crossProduct>>().toEqualTypeOf<"a-1" | "a-2" | "b-1" | "b-2">()
  assert.equal(spell(crossProduct), "`${\"a\" | \"b\"}-${1 | 2}`")

  const TParam = T.TypeParam("T", T.Union(T.String, T.Number))
  const symbolic = T.Template(["value-", ""], TParam)
  expectTypeOf<T.Abstract<T.TypeDenotes<typeof symbolic>>>().toEqualTypeOf<true>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof symbolic>, [typeof TParam], ["x" | 1]>>().toEqualTypeOf<"value-x" | "value-1">()
  assert.equal(spell(symbolic, [TParam]), "`value-${T}`")
})

test("template literal types check their arity and interpolation types", () => {
  assert.throws(() => T.Template(["a", "b", "c"], T.Literal(1)), /needs 2 parts, got 3/)
  T.Template(["", ""], T.TypeParam("Text", T.String))
  T.Template(["", ""], T.TypeParam("Anything", T.Any))
  const Nothing = T.TypeParam("Nothing", T.Never)
  T.Template(["", ""], Nothing)
  T.Template(["", ""], T.hostType<string | number>("StringOrNumber"))
  const Base = T.TypeParam("Base", T.String)
  T.Template(["", ""], T.TypeParam("Dependent", Base))
  // @ts-expect-error - an unconstrained type parameter is not proven interpolable
  T.Template(["", ""], T.TypeParam("T"))
  // @ts-expect-error - an unknown constraint is not proven interpolable
  T.Template(["", ""], T.TypeParam("T", T.Unknown))
  // @ts-expect-error - an object constraint is not interpolable
  T.Template(["", ""], T.TypeParam("T", T.Object({ value: T.Number })))
  // @ts-expect-error - object types cannot be template literal interpolations
  T.Template(["", ""], T.Object({ value: T.Number }))
  // @ts-expect-error - object reference phantoms cannot be template literal interpolations
  T.Template(["", ""], T.hostType<{ value: number }>("RecordType"))
  // @ts-expect-error - symbol cannot be a template literal interpolation
  T.Template(["", ""], T.hostType<symbol>("SymbolType"))
})

test("operators over concrete types denote the evaluated type", () => {
  const obj = T.Object({ name: T.String, age: T.Number })
  expectTypeOf<T.TypeDenotes<T.KeyOf<typeof obj>>>().toEqualTypeOf<"name" | "age">()
  expectTypeOf<T.TypeDenotes<T.IndexedAccess<typeof obj, T.LiteralType<"age">>>>().toEqualTypeOf<number>()
  const literal = T.Template(["hello-", ""], T.Literal("world"))
  expectTypeOf<T.TypeDenotes<typeof literal>>().toEqualTypeOf<"hello-world">()
  const cond = T.Conditional(T.String, T.String, T.Literal(1), T.Literal(2))
  expectTypeOf<T.TypeDenotes<typeof cond>>().toEqualTypeOf<1>()
  const concreteUnion = T.Conditional(T.Union(T.String, T.Number), T.String, T.Literal(1), T.Literal(2))
  expectTypeOf<T.TypeDenotes<typeof concreteUnion>>().toEqualTypeOf<2>()
})

test("mapped substitution keeps positional args aligned when its key shadows a param", () => {
  const key = T.TypeParam("K")
  const source = T.TypeParam("S")
  const value = T.TypeParam("V")
  const body = T.Object({ source, value })

  const keyFirst = substitute(
    T.Mapped("K", source, body),
    [key, source, value],
    [T.Literal("shadowed"), T.String, T.Number],
  ) as T.Mapped
  assert.equal((keyFirst.source as T.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyFirst.body as T.Object).fields).map(([name, field]) => [name, (T.fieldOf(field).type as T.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )

  const keyMiddle = substitute(
    T.Mapped("K", source, body),
    [source, key, value],
    [T.String, T.Literal("shadowed"), T.Number],
  ) as T.Mapped
  assert.equal((keyMiddle.source as T.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyMiddle.body as T.Object).fields).map(([name, field]) => [name, (T.fieldOf(field).type as T.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )
})

test("logical operators stay symbolic and reduce after substitution", () => {
  type And = T.LogicalDenote<"and", T.Variable<"T">, "right">
  type Or = T.LogicalDenote<"or", T.Variable<"T">, "right">
  expectTypeOf<And>().toEqualTypeOf<T.Op<"and", [T.Variable<"T">, "right"]>>()
  expectTypeOf<T.Substitute<And, [T.TypeParam<"T", any>], [false]>>().toEqualTypeOf<false>()
  expectTypeOf<T.Substitute<And, [T.TypeParam<"T", any>], [true]>>().toEqualTypeOf<"right">()
  expectTypeOf<T.Substitute<Or, [T.TypeParam<"T", any>], [unknown]>>().toEqualTypeOf<{}>()
  type AndNever = T.LogicalDenote<"and", never, "right">
  type OrNever = T.LogicalDenote<"or", never, "right">
  expectTypeOf<Equal<AndNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<OrNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<T.LogicalDenote<"and", unknown, "right">, unknown>>().toEqualTypeOf<true>()
  expectTypeOf<T.LogicalDenote<"or", unknown, "right">>().toEqualTypeOf<{}>()
  expectTypeOf<T.LogicalDenote<"and", number, "right">>().toEqualTypeOf<0 | "right">()
  expectTypeOf<T.LogicalDenote<"or", number, "right">>().toEqualTypeOf<number | "right">()
})

test("Substitute reduces symbolic operators once generic args arrive", () => {
  type CondBody = T.Op<"cond", [T.Variable<"T">, string, T.Variable<"T">, never]>
  expectTypeOf<T.Substitute<CondBody, [T.TypeParam<"T", any>], [string]>>().toEqualTypeOf<string>()
  type SubNull = T.Substitute<CondBody, [T.TypeParam<"T", any>], [null]>
  expectTypeOf<Equal<SubNull, never>>().toEqualTypeOf<true>()

  type IndexBody = T.Op<"index", [{ name: string; age: number }, T.Variable<"K">]>
  expectTypeOf<T.Substitute<IndexBody, [T.TypeParam<"K", any>], ["name"]>>().toEqualTypeOf<string>()

  type MappedBody = T.Op<"mapped", [{ a: string; b: number }, T.Op<"index", [{ a: string; b: number }, T.Variable<"K">]>, "K"]>
  expectTypeOf<T.Substitute<MappedBody, [], []>>().toEqualTypeOf<{ a: string; b: number }>()
})

test("conditional AST substitution preserves naked and wrapped checks", () => {
  const TParam = T.TypeParam("T")
  const concrete = T.Conditional(T.Union(T.String, T.Number), T.String, T.Literal(1), T.Literal(2))
  const concreteResult = substitute(concrete, [], []) as T.Conditional
  assert.equal(concreteResult.kind, "conditional")
  assert.equal((concreteResult.check as T.Union).members.length, 2)

  const naked = T.Conditional(TParam, T.String, T.Literal(1), T.Literal(2))
  const nakedResult = substitute(naked, [TParam], [T.Union(T.String, T.Number)]) as T.Conditional
  assert.equal(nakedResult.kind, "conditional")
  assert.equal((nakedResult.check as T.Union).members.length, 2)

  const wrapped = T.Conditional(T.Tuple(TParam), T.Tuple(T.String), T.Literal(1), T.Literal(2))
  const wrappedResult = substitute(wrapped, [TParam], [T.Union(T.String, T.Number)]) as T.Conditional
  assert.equal(wrappedResult.kind, "conditional")
  assert.equal(((wrappedResult.check as T.TupleType).items[0] as T.Union).members.length, 2)
})

test("conditionals bind infer variables against the checked type", () => {
  const TParam = T.TypeParam("T")
  const U = T.TypeParam("U")
  const Unwrap = T.Conditional(TParam, T.Promise(T.Infer("U")), U, TParam)
  const params = [TParam] as const

  expectTypeOf<T.Substitute<T.TypeDenotes<typeof Unwrap>, [typeof TParam], [Promise<number>]>>().toEqualTypeOf<number>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof Unwrap>, [typeof TParam], [string]>>().toEqualTypeOf<string>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof Unwrap>, [typeof TParam], [Promise<number> | boolean]>>().toEqualTypeOf<number | boolean>()

  const field = T.Conditional(TParam, T.Object({ value: T.Infer("V") }), T.TypeParam("V"), T.Never)
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof field>, [typeof TParam], [{ value: boolean; other: 1 }]>>().toEqualTypeOf<boolean>()
  expectTypeOf<Equal<T.Substitute<T.TypeDenotes<typeof field>, [typeof TParam], [string]>, never>>().toEqualTypeOf<true>()

  const pair = T.Conditional(TParam, T.Tuple(T.Infer("A"), T.Infer("B")), T.Tuple(T.TypeParam("B"), T.TypeParam("A")), T.Never)
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof pair>, [typeof TParam], [[1, "x"]]>>().toEqualTypeOf<["x", 1]>()

  const element = T.Conditional(TParam, T.Array(T.Infer("E")), T.TypeParam("E"), TParam)
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof element>, [typeof TParam], [string[]]>>().toEqualTypeOf<string>()

  const wrapped = T.Conditional(T.Tuple(TParam), T.Tuple(T.String), T.Literal(true), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof wrapped>, [typeof TParam], [string | number]>>().toEqualTypeOf<false>()

  const concreteInfer = T.Conditional(
    T.Union(T.Promise(T.Number), T.Boolean),
    T.Promise(T.Infer("U")),
    T.TypeParam("U"),
    T.Literal(false),
  )
  expectTypeOf<T.TypeDenotes<typeof concreteInfer>>().toEqualTypeOf<false>()

  const objectInfer = T.Conditional(TParam, T.Object({ x: T.Infer("U") }), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof objectInfer>, [typeof TParam], [any]>>().toEqualTypeOf<unknown | false>()
  const tupleInfer = T.Conditional(TParam, T.Tuple(T.Infer("U")), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof tupleInfer>, [typeof TParam], [any]>>().toEqualTypeOf<unknown>()
  const functionInfer = T.Conditional(TParam, T.Function([T.Infer("U")], T.Any), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof functionInfer>, [typeof TParam], [any]>>().toEqualTypeOf<unknown>()
  const returnInfer = T.Conditional(TParam, T.Function([], T.Infer("U"), T.Any), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof returnInfer>, [typeof TParam], [any]>>().toEqualTypeOf<unknown | false>()
  const promiseInfer = T.Conditional(TParam, T.Promise(T.Infer("U")), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof promiseInfer>, [typeof TParam], [any]>>().toEqualTypeOf<unknown | false>()

  const ordinaryAny = T.Conditional(TParam, T.String, T.Literal(true), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof ordinaryAny>, [typeof TParam], [any]>>().toEqualTypeOf<true | false>()

  const repeatedTuple = T.Conditional(TParam, T.Tuple(T.Infer("U"), T.Infer("U")), T.TypeParam("U"), T.Literal(false))
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof repeatedTuple>, [typeof TParam], [[string, number]]>>().toEqualTypeOf<string | number>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof repeatedTuple>, [typeof TParam], [any]>>().toEqualTypeOf<unknown>()

  const repeatedObject = T.Conditional(
    TParam,
    T.Object({ a: T.Infer("U"), b: T.Infer("U") }),
    T.TypeParam("U"),
    T.Literal(false),
  )
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof repeatedObject>, [typeof TParam], [{ a: string; b: number }]>>()
    .toEqualTypeOf<string | number>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof repeatedObject>, [typeof TParam], [any]>>().toEqualTypeOf<unknown | false>()

  const repeatedFunction = T.Conditional(
    TParam,
    T.Function([T.Infer("U"), T.Infer("U")], T.Void),
    T.TypeParam("U"),
    T.Literal(false),
  )
  type RepeatedFunctionResult = T.Substitute<T.TypeDenotes<typeof repeatedFunction>, [typeof TParam], [(a: string, b: number) => void]>
  expectTypeOf<Equal<RepeatedFunctionResult, never>>().toEqualTypeOf<true>()
  expectTypeOf<T.Substitute<T.TypeDenotes<typeof repeatedFunction>, [typeof TParam], [any]>>().toEqualTypeOf<unknown>()

  const nestedFunction = T.Conditional(
    TParam,
    T.Function(
      [T.Function([T.Infer("U")], T.Void), T.Function([T.Infer("U")], T.Void)],
      T.Void,
    ),
    T.TypeParam("U"),
    T.Literal(false),
  )
  expectTypeOf<
    T.Substitute<T.TypeDenotes<typeof nestedFunction>, [typeof TParam], [(a: (x: string) => void, b: (x: number) => void) => void]>
  >().toEqualTypeOf<string | number>()

  const mixedVariance = T.Conditional(
    TParam,
    T.Object({ value: T.Infer("U"), consume: T.Function([T.Infer("U")], T.Void) }),
    T.TypeParam("U"),
    T.Literal(false),
  )
  type MixedVarianceResult = T.Substitute<
    T.TypeDenotes<typeof mixedVariance>,
    [typeof TParam],
    [{ value: string; consume: (x: number) => void }]
  >
  const mixedConflict: MixedVarianceResult = false
  void mixedConflict
  type MixedSame = T.Substitute<
    T.TypeDenotes<typeof mixedVariance>,
    [typeof TParam],
    [{ value: string; consume: (x: string) => void }]
  >
  expectTypeOf<Equal<MixedSame, string>>().toEqualTypeOf<true>()
  type MixedCovariantSubtype = T.Substitute<
    T.TypeDenotes<typeof mixedVariance>,
    [typeof TParam],
    [{ value: "x"; consume: (x: string) => void }]
  >
  const mixedCovariantSubtype: MixedCovariantSubtype = "x"
  void mixedCovariantSubtype
  type MixedContravariantSubtype = T.Substitute<
    T.TypeDenotes<typeof mixedVariance>,
    [typeof TParam],
    [{ value: string; consume: (x: "x") => void }]
  >
  const mixedContravariantSubtype: MixedContravariantSubtype = false
  void mixedContravariantSubtype

  expectTypeOf<T.Abstract<T.TypeDenotes<typeof Unwrap>>>().toEqualTypeOf<true>()
  void params
})

test("a declared generic with infer resolves when applied", () => {
  const TParam = T.TypeParam("T")
  let Resolved!: T.TypeRef<any>
  T.build(function*() {
    const Unwrap = yield* T.type("Unwrap", {
      params: [TParam],
      body: T.Conditional(TParam, T.Promise(T.Infer("U")), T.TypeParam("U"), TParam),
    })
    const applied = T.Apply(Unwrap, [T.Promise(T.Number)])
    expectTypeOf<T.TypeDenotes<typeof applied>>().toEqualTypeOf<number>()
    Resolved = yield* T.type("Resolved", applied)
    return null
  })
  assert.equal(Resolved.nameHint, "Resolved")
})

test("a host generic stays symbolic until its argument is concrete", () => {
  const TParam = T.TypeParam("T")
  T.build(function*() {
    const Wrap = yield* T.type("Wrap", { params: [TParam], body: T.Promise(TParam) })
    const applied = T.Apply(Wrap, [T.Number])
    expectTypeOf<T.TypeDenotes<typeof applied>>().toEqualTypeOf<Promise<number>>()
    const Twice = yield* T.type("Twice", { params: [TParam], body: T.Apply(Wrap, [T.Apply(Wrap, [TParam])]) })
    const twice = T.Apply(Twice, [T.String])
    expectTypeOf<T.TypeDenotes<typeof twice>>().toEqualTypeOf<Promise<Promise<string>>>()
    return null
  })
  expectTypeOf<T.Abstract<T.TypeDenotes<ReturnType<typeof T.Promise<typeof TParam>>>>>().toEqualTypeOf<true>()
})

test("Abstract only fires for unresolved symbolic information", () => {
  expectTypeOf<T.Abstract<[unknown, T.Variable<"T">]>>().toEqualTypeOf<true>()
  expectTypeOf<T.Abstract<{ a: unknown; b: T.Variable<"T"> }>>().toEqualTypeOf<true>()
  expectTypeOf<T.Abstract<[unknown, string]>>().toEqualTypeOf<false>()
  expectTypeOf<T.Abstract<Promise<number>>>().toEqualTypeOf<false>()
  expectTypeOf<T.Abstract<(x: T.Variable<"T">) => void>>().toEqualTypeOf<true>()
  expectTypeOf<T.Abstract<T.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<T.Abstract<string>>().toEqualTypeOf<false>()
  expectTypeOf<T.Abstract<{ a: string }>>().toEqualTypeOf<false>()
  expectTypeOf<T.Abstract<string | T.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<{ x: 1 } extends T.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends T.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends T.Variable<any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{ x: 1 } extends T.Op<any, any> ? true : false>().toEqualTypeOf<false>()
})

test("Instantiate substitutes through operator nodes at runtime", () => {
  const TParam = T.TypeParam("T")
  let instantiated!: T.Instantiation<any, any, any, any>
  T.build(function*() {
    const keys = yield* fn("keys", {
      typeParams: [TParam],
      params: [T.param("value", TParam)],
      returns: T.KeyOf(TParam),
      body: function*({ value }) {
        return value as never
      },
    })
    instantiated = T.instantiate(keys, T.Object({ a: T.Number }))
    return null
  })
  const signature = instantiated.type as T.FunctionType
  const returned = signature.return as T.KeyOf
  assert.equal(returned.kind, "keyof")
  assert.equal((returned.operand as T.AnyType).kind, "object")
})

test("a type alias identity is declared once per program", () => {
  const alias = T.type("Id", T.String)
  assert.throws(
    () =>
      T.build(function*() {
        yield* alias
        yield* alias
        return null
      }),
    /declared more than once with the same identity/,
  )
})

test("a type reference must resolve to an in-scope alias", () => {
  const alias = T.build(function*() {
    return yield* T.type("Missing", T.String)
  }).result
  assert.throws(
    () =>
      T.build(function*() {
        yield* T.const("id", "a", alias)
        return null
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("a reference to a host type emits its name", () => {
  const Custom = T.hostType<{ readonly custom: true }>("MyCustomType")
  const program = T.build(function*() {
    yield* fn("process", {
      params: [T.param("x", Custom)],
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
  const record = T.External("Record", T.Literal("name"), T.Unknown)
  assert.equal(propType(record, "name"), T.Unknown)
  assert.equal(propType(record, "other"), undefined)
  const object = T.Object({ name: T.String, count: T.Number })
  assert.equal(propType(T.Intersection(object, record), "name"), T.String)
  assert.equal(propType(T.Intersection(object, record), "count"), T.Number)
  assert.equal(propType(T.Intersection(T.Object({ id: T.Number }), record), "name"), T.Unknown)
  assert.equal(propType(T.Intersection(object, T.Object({ name: T.Number })), "name"), undefined)
})
