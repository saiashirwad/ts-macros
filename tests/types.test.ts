import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Type } from "../src/index.ts"
import { lub, sameType, substitute, widen } from "../src/types/algebra.ts"
import { elementType, propType } from "../src/typing.ts"
import { typeChildren } from "../src/walk.ts"
import { emitProgram } from "../targets/ts.ts"
import { type Equal, expectTypeOf } from "./typing.ts"

const fn = Decl.fn

const spell = (body: Type.Type<any>, params: Type.AnyParams = []): string => {
  const program = Program.build(function*() {
    yield* Decl.type("T", { params, body })
    return null
  })
  return emitProgram(program).replace(/^type T(?:_\d+)?(<[^>]*>)? = /, "").replace(/;$/, "")
}

test("literal types reject non-finite numbers", () => {
  Type.literal(-0)
  Type.literal(1.5)

  assert.throws(() => Type.literal(NaN), /literal number must be finite, got NaN/)
  assert.throws(() => Type.literal(Infinity), /literal number must be finite, got Infinity/)
  assert.throws(() => Type.literal(-Infinity), /literal number must be finite, got -Infinity/)
})

test("type operators emit the TypeScript you would write by hand", () => {
  const T = Type.param("T")
  const K = Type.param("K")
  const obj = Type.object({ a: Type.number, b: Type.string })

  assert.equal(spell(Type.keyof(obj)), "keyof { a: number; b: string }")
  assert.equal(spell(Type.index(obj, Type.literal("a"))), "{ a: number; b: string }[\"a\"]")
  assert.equal(spell(Type.intersection(obj, Type.object({ c: Type.boolean }))), "{ a: number; b: string } & { c: boolean }")
  assert.equal(spell(Type.conditional(T, Type.string, Type.literal(true), Type.literal(false)), [T]), "T extends string ? true : false")
  assert.equal(spell(Type.mapped("K", T, Type.index(T, K)), [T]), "{ [K in keyof T]: T[K] }")
  assert.equal(spell(Type.template(["id-", ""], Type.number)), "`id-${number}`")
  assert.equal(
    spell(Type.conditional(T, Type.array(Type.infer("E")), Type.param("E"), Type.never), [T]),
    "T extends (infer E)[] ? E : never",
  )
})

test("the text emitter parenthesizes types by precedence", () => {
  assert.equal(spell(Type.array(Type.union(Type.string, Type.number))), "(string | number)[]")
  assert.equal(spell(Type.array(Type.number)), "number[]")
  assert.equal(spell(Type.union(Type.fn([], Type.number), Type.string)), "(() => number) | string")
  assert.equal(spell(Type.union(Type.intersection(Type.string, Type.number), Type.boolean)), "string & number | boolean")
  assert.equal(spell(Type.keyof(Type.union(Type.string, Type.number))), "keyof (string | number)")
})

test("readonly arrays preserve their modifier throughout the type algebra", () => {
  const items = Type.readonlyArray(Type.literal("yes"))
  const mutable = Type.array(Type.literal("yes"))
  const T = Type.param("T")
  const symbolic = Type.readonlyArray(T)
  const exact: Equal<Type.Denotes<typeof items>, readonly "yes"[]> = true
  const applied: Equal<Type.Substitute<Type.Denotes<typeof symbolic>, [typeof T], [number]>, readonly number[]> = true
  void exact
  void applied
  assert.equal(spell(items), "readonly \"yes\"[]")
  assert.equal(spell(Type.readonlyArray(Type.union(Type.string, Type.number))), "readonly (string | number)[]")
  assert.equal(spell(Type.array(Type.readonlyArray(Type.number))), "(readonly number[])[]")
  assert.equal(spell(Type.readonlyArray(Type.array(Type.number))), "readonly (number[])[]")
  assert.equal(spell(Type.keyof(items)), "keyof readonly \"yes\"[]")
  assert.equal(spell(Type.index(items, Type.number)), "(readonly \"yes\"[])[number]")
  assert.equal(spell(Type.fn([], Type.void, Type.readonlyArray(Type.number))), "(...arg0: readonly number[]) => void")
  assert.equal(sameType(items, mutable), false)
  assert.equal(sameType(items, Type.readonlyArray(Type.literal("yes"))), true)
  assert.equal((lub([items, mutable]) as Type.Union).members.length, 2)
  assert.ok(sameType(widen(items), Type.readonlyArray(Type.string)))
  assert.ok(sameType(substitute(symbolic, [T], [Type.number]), Type.readonlyArray(Type.number)))
  assert.deepEqual(typeChildren(items), [items.element])
  assert.equal(elementType(items), items.element)
  assert.ok(sameType(elementType(Type.union(items, Type.array(Type.number)))!, Type.union(Type.literal("yes"), Type.number)))
  assert.ok(sameType(elementType(Type.tuple(Type.number, Type.string))!, Type.union(Type.number, Type.string)))
})

test("function types accept array, tuple, and constrained symbolic rest types", () => {
  const arrayFn = Type.fn([Type.string], Type.void, Type.array(Type.number))
  assert.equal(spell(arrayFn), "(arg0: string, ...arg1: number[]) => void")
  expectTypeOf<Type.Denotes<typeof arrayFn>>().toEqualTypeOf<(arg0: string, ...rest: number[]) => void>()

  const tupleFn = Type.fn([], Type.void, Type.tuple(Type.string, Type.number))
  assert.equal(spell(tupleFn), "(...arg0: [string, number]) => void")
  expectTypeOf<Type.Denotes<typeof tupleFn>>().toEqualTypeOf<(...rest: [string, number]) => void>()

  const constrainedArray = Type.param("A", Type.array(Type.unknown))
  const arrayGeneric = Type.fn([], Type.void, constrainedArray)
  assert.equal(spell(arrayGeneric, [constrainedArray]), "(...arg0: A) => void")

  const constrainedTuple = Type.param("T", Type.tuple(Type.string, Type.number))
  const tupleGeneric = Type.fn([], Type.void, constrainedTuple)
  assert.equal(spell(tupleGeneric, [constrainedTuple]), "(...arg0: T) => void")
  assert.equal(
    emitProgram(Program.build(function*() {
      yield* Decl.type("RestFunction", { params: [constrainedTuple], body: tupleGeneric })
      return null
    })),
    "type RestFunction<T extends [string, number]> = (...arg0: T) => void;",
  )

  const readonlyArray = FFI.Type<readonly string[]>("ReadonlyArray", Type.string)
  Type.fn([], Type.void, readonlyArray)
  const readonlyTuple = FFI.Type<readonly [string, number]>("ReadonlyPair")
  Type.fn([], Type.void, readonlyTuple)
  const anyFn = Type.fn([], Type.void, Type.any)
  assert.equal(spell(anyFn), "(...arg0: any) => void")

  // @ts-expect-error - a primitive cannot be used as a function rest type
  Type.fn([], Type.void, Type.number)
  // @ts-expect-error - an object cannot be used as a function rest type
  Type.fn([], Type.void, Type.object({ value: Type.number }))
  // @ts-expect-error - an unconstrained symbolic type is not proven array-like
  Type.fn([], Type.void, Type.param("R"))
  // @ts-expect-error - a symbolic type constrained to a primitive is not array-like
  Type.fn([], Type.void, Type.param("R", Type.number))
  // @ts-expect-error - TypeScript does not allow `T extends any` as a rest type
  Type.fn([], Type.void, Type.param("R", Type.any))
})

test("a declared rest parameter shows up in the inferred signature", () => {
  const program = Program.build(function*() {
    yield* fn("sum", {
      params: [Expr.param("first", Type.number), Expr.rest("more", Type.number)],
      body: function*({ first }) {
        return first
      },
    })
    return null
  })
  const signature = (program.statements[0] as Decl.BuiltFunction).type as Type.FunctionType
  assert.equal(signature.params.length, 1)
  assert.equal((signature.rest as Type.Any).kind, "array")
  assert.match(emitProgram(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
})

test("object field modifiers show up on the phantom and in emit", () => {
  const obj = Type.object({
    id: Type.readonly(Type.number),
    nick: Type.optional(Type.string),
    both: Type.readonly(Type.optional(Type.boolean)),
    name: Type.string,
  })
  expectTypeOf<Type.Denotes<typeof obj>>().toEqualTypeOf<
    { readonly id: number; nick?: string; readonly both?: boolean; name: string }
  >()

  assert.equal(spell(obj), "{ readonly id: number; nick?: string; readonly both?: boolean; name: string }")

  const program = Program.build(function*() {
    yield* Decl.let("record", Expr.object({ id: Expr.number(1) }), Type.object({ id: Type.readonly(Type.number) }))
    return null
  })
  assert.equal(emitProgram(program), "let record: { readonly id: number } = { id: 1 };")
})

test("a type alias body receives its params by name, constraints included", () => {
  const T = Type.param("T", Type.string)
  let seen!: typeof T
  const program = Program.build(function*() {
    const Box = yield* Decl.type("Box", {
      params: [T],
      body: ({ T: got }) => {
        seen = got
        expectTypeOf<Type.Denotes<typeof got>>().toEqualTypeOf<Type.Variable<"T"> & string>()
        return Type.object({ value: got })
      },
    })
    const applied = Type.apply(Box, [Type.literal("ok")])
    expectTypeOf<Type.Denotes<typeof applied>>().toEqualTypeOf<{ value: "ok" }>()
    // @ts-expect-error - T must extend string
    Type.apply(Box, [Type.number])

    const Pair = yield* Decl.type("Pair", {
      params: [T, Type.param("U", T)],
      body: ({ T: got, U }) => {
        expectTypeOf<Type.Denotes<typeof U>>().toEqualTypeOf<Type.Variable<"U"> & Type.Variable<"T"> & string>()
        return Type.tuple(got, U)
      },
    })
    Type.apply(Pair, [Type.string, Type.literal("ok")])
    // @ts-expect-error - U must extend the argument supplied for T
    Type.apply(Pair, [Type.literal("ok"), Type.string])
    return Pair
  })
  assert.equal(seen, T)
  assert.equal(
    emitProgram(program),
    "type Box<T extends string> = { value: T };\ntype Pair<T extends string, U extends T> = [T, U];",
  )

  // @ts-expect-error - adjacent type parameters cannot have the same name
  Decl.type("Bad", { params: [T, Type.param("T")], body: ({ T: got }) => got })
  // @ts-expect-error - a body can only name the params that were declared
  Decl.type("Box", { params: [T], body: ({ U }) => U ?? Type.never })
})

test("type parameter names are distinct", () => {
  const T = Type.param("T")
  const U = Type.param("U")
  const V = Type.param("V")

  Decl.type("Pair", { params: [T, U], body: Type.tuple(T, U) })
  fn("pick", {
    typeParams: [T, U, V],
    body: function*() {
      return Expr.number(1)
    },
  })

  // @ts-expect-error - adjacent type parameters cannot have the same name
  Decl.type("Bad", { params: [T, Type.param("T")], body: T })
  // @ts-expect-error - nonadjacent type parameters cannot have the same name
  Decl.type("Bad", { params: [T, U, Type.param("T")], body: T })
  // @ts-expect-error - adjacent function type parameters cannot have the same name
  Decl.fn("bad", {
    typeParams: [T, Type.param("T")],
    body: function*() {
      return Expr.number(1)
    },
  })
  // @ts-expect-error - nonadjacent function type parameters cannot have the same name
  Decl.fn("bad", {
    typeParams: [T, U, Type.param("T")],
    body: function*() {
      return Expr.number(1)
    },
  })
})

test("a field modifier is not a type, so it compiles only as a field of an object type", () => {
  // @ts-expect-error - an element is a type
  Type.array(Type.readonly(Type.number))
  // @ts-expect-error - a union member is a type
  Type.union(Type.optional(Type.number), Type.string)
  // @ts-expect-error - a param's type is a type
  Expr.param("p", Type.optional(Type.number))
  // @ts-expect-error - a type alias's body is a type
  Decl.type("T", Type.readonly(Type.number))
})

test("reading a field gives the field's type, without its modifiers", () => {
  const Rec = Type.object({ id: Type.readonly(Type.number), nick: Type.optional(Type.string) })
  const program = Program.build(function*() {
    yield* fn("getId", {
      params: [Expr.param("rec", Rec)],
      body: function*({ rec }) {
        return Expr.prop(rec, "id")
      },
    })
    yield* fn("getNick", {
      params: [Expr.param("rec", Rec)],
      body: function*({ rec }) {
        const nick = Expr.prop(rec, "nick")
        expectTypeOf<Expr.Denotes<typeof nick>>().toEqualTypeOf<any>()
        return nick
      },
    })
    return null
  })
  const returned = (statement: unknown): Type.Any => ((statement as Decl.BuiltFunction).type as Type.FunctionType).return as Type.Any
  const [getId, getNick] = program.statements
  assert.equal((returned(getId) as Type.Primitive).name, "number")
  const nick = returned(getNick) as Type.Union
  assert.deepEqual(nick.members.map((member) => (member as Type.Primitive).name), ["string", "undefined"])
  assert.match(emitProgram(program), /function getId\(rec: \{ readonly id: number; nick\?: string \}\) \{/)
})

test("template literal types accept TypeScript's interpolation primitives", () => {
  const primitives = Type.template(
    ["s:", ",n:", ",b:", ",bool:", ",null:", ",undefined:", ""],
    Type.literal("x"),
    Type.literal(1),
    FFI.Type<2n>("Big"),
    Type.literal(true),
    Type.null,
    Type.undefined,
  )
  expectTypeOf<Type.Denotes<typeof primitives>>().toEqualTypeOf<"s:x,n:1,b:2,bool:true,null:null,undefined:undefined">()
  assert.equal(spell(primitives), "`s:${\"x\"},n:${1},b:${Big},bool:${true},null:${null},undefined:${undefined}`")

  const crossProduct = Type.template(
    ["", "-", ""],
    Type.union(Type.literal("a"), Type.literal("b")),
    Type.union(Type.literal(1), Type.literal(2)),
  )
  expectTypeOf<Type.Denotes<typeof crossProduct>>().toEqualTypeOf<"a-1" | "a-2" | "b-1" | "b-2">()
  assert.equal(spell(crossProduct), "`${\"a\" | \"b\"}-${1 | 2}`")

  const T = Type.param("T", Type.union(Type.string, Type.number))
  const symbolic = Type.template(["value-", ""], T)
  expectTypeOf<Type.Abstract<Type.Denotes<typeof symbolic>>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof symbolic>, [typeof T], ["x" | 1]>>().toEqualTypeOf<"value-x" | "value-1">()
  assert.equal(spell(symbolic, [T]), "`value-${T}`")
})

test("template literal types check their arity and interpolation types", () => {
  assert.throws(() => Type.template(["a", "b", "c"], Type.literal(1)), /needs 2 parts, got 3/)
  Type.template(["", ""], Type.param("Text", Type.string))
  Type.template(["", ""], Type.param("Anything", Type.any))
  const Nothing = Type.param("Nothing", Type.never)
  Type.template(["", ""], Nothing)
  Type.template(["", ""], FFI.Type<string | number>("StringOrNumber"))
  const Base = Type.param("Base", Type.string)
  Type.template(["", ""], Type.param("Dependent", Base))
  // @ts-expect-error - an unconstrained type parameter is not proven interpolable
  Type.template(["", ""], Type.param("T"))
  // @ts-expect-error - an unknown constraint is not proven interpolable
  Type.template(["", ""], Type.param("T", Type.unknown))
  // @ts-expect-error - an object constraint is not interpolable
  Type.template(["", ""], Type.param("T", Type.object({ value: Type.number })))
  // @ts-expect-error - object types cannot be template literal interpolations
  Type.template(["", ""], Type.object({ value: Type.number }))
  // @ts-expect-error - object reference phantoms cannot be template literal interpolations
  Type.template(["", ""], FFI.Type<{ value: number }>("RecordType"))
  // @ts-expect-error - symbol cannot be a template literal interpolation
  Type.template(["", ""], FFI.Type<symbol>("SymbolType"))
})

test("operators over concrete types denote the evaluated type", () => {
  const obj = Type.object({ name: Type.string, age: Type.number })
  expectTypeOf<Type.Denotes<Type.KeyOf<typeof obj>>>().toEqualTypeOf<"name" | "age">()
  expectTypeOf<Type.Denotes<Type.IndexedAccess<typeof obj, Type.Literal<"age">>>>().toEqualTypeOf<number>()
  const literal = Type.template(["hello-", ""], Type.literal("world"))
  expectTypeOf<Type.Denotes<typeof literal>>().toEqualTypeOf<"hello-world">()
  const cond = Type.conditional(Type.string, Type.string, Type.literal(1), Type.literal(2))
  expectTypeOf<Type.Denotes<typeof cond>>().toEqualTypeOf<1>()
  const concreteUnion = Type.conditional(Type.union(Type.string, Type.number), Type.string, Type.literal(1), Type.literal(2))
  expectTypeOf<Type.Denotes<typeof concreteUnion>>().toEqualTypeOf<2>()
})

test("mapped substitution keeps positional args aligned when its key shadows a param", () => {
  const key = Type.param("K")
  const source = Type.param("S")
  const value = Type.param("V")
  const body = Type.object({ source, value })

  const keyFirst = substitute(
    Type.mapped("K", source, body),
    [key, source, value],
    [Type.literal("shadowed"), Type.string, Type.number],
  ) as Type.Mapped
  assert.equal((keyFirst.source as Type.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyFirst.body as Type.Object).fields).map(([name, field]) => [name, (Type.fieldOf(field).type as Type.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )

  const keyMiddle = substitute(
    Type.mapped("K", source, body),
    [source, key, value],
    [Type.string, Type.literal("shadowed"), Type.number],
  ) as Type.Mapped
  assert.equal((keyMiddle.source as Type.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyMiddle.body as Type.Object).fields).map(([name, field]) => [name, (Type.fieldOf(field).type as Type.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )
})

test("logical operators stay symbolic and reduce after substitution", () => {
  type And = Type.LogicalDenote<"and", Type.Variable<"T">, "right">
  type Or = Type.LogicalDenote<"or", Type.Variable<"T">, "right">
  expectTypeOf<And>().toEqualTypeOf<Type.Op<"and", [Type.Variable<"T">, "right"]>>()
  expectTypeOf<Type.Substitute<And, [Type.Param<"T", any>], [false]>>().toEqualTypeOf<false>()
  expectTypeOf<Type.Substitute<And, [Type.Param<"T", any>], [true]>>().toEqualTypeOf<"right">()
  expectTypeOf<Type.Substitute<Or, [Type.Param<"T", any>], [unknown]>>().toEqualTypeOf<{}>()
  type AndNever = Type.LogicalDenote<"and", never, "right">
  type OrNever = Type.LogicalDenote<"or", never, "right">
  expectTypeOf<Equal<AndNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<OrNever, never>>().toEqualTypeOf<true>()
  expectTypeOf<Equal<Type.LogicalDenote<"and", unknown, "right">, unknown>>().toEqualTypeOf<true>()
  expectTypeOf<Type.LogicalDenote<"or", unknown, "right">>().toEqualTypeOf<{}>()
  expectTypeOf<Type.LogicalDenote<"and", number, "right">>().toEqualTypeOf<0 | "right">()
  expectTypeOf<Type.LogicalDenote<"or", number, "right">>().toEqualTypeOf<number | "right">()
})

test("Substitute reduces symbolic operators once generic args arrive", () => {
  type CondBody = Type.Op<"cond", [Type.Variable<"T">, string, Type.Variable<"T">, never]>
  expectTypeOf<Type.Substitute<CondBody, [Type.Param<"T", any>], [string]>>().toEqualTypeOf<string>()
  type SubNull = Type.Substitute<CondBody, [Type.Param<"T", any>], [null]>
  expectTypeOf<Equal<SubNull, never>>().toEqualTypeOf<true>()

  type IndexBody = Type.Op<"index", [{ name: string; age: number }, Type.Variable<"K">]>
  expectTypeOf<Type.Substitute<IndexBody, [Type.Param<"K", any>], ["name"]>>().toEqualTypeOf<string>()

  type MappedBody = Type.Op<"mapped", [{ a: string; b: number }, Type.Op<"index", [{ a: string; b: number }, Type.Variable<"K">]>, "K"]>
  expectTypeOf<Type.Substitute<MappedBody, [], []>>().toEqualTypeOf<{ a: string; b: number }>()
})

test("conditional AST substitution preserves naked and wrapped checks", () => {
  const T = Type.param("T")
  const concrete = Type.conditional(Type.union(Type.string, Type.number), Type.string, Type.literal(1), Type.literal(2))
  const concreteResult = substitute(concrete, [], []) as Type.Conditional
  assert.equal(concreteResult.kind, "conditional")
  assert.equal((concreteResult.check as Type.Union).members.length, 2)

  const naked = Type.conditional(T, Type.string, Type.literal(1), Type.literal(2))
  const nakedResult = substitute(naked, [T], [Type.union(Type.string, Type.number)]) as Type.Conditional
  assert.equal(nakedResult.kind, "conditional")
  assert.equal((nakedResult.check as Type.Union).members.length, 2)

  const wrapped = Type.conditional(Type.tuple(T), Type.tuple(Type.string), Type.literal(1), Type.literal(2))
  const wrappedResult = substitute(wrapped, [T], [Type.union(Type.string, Type.number)]) as Type.Conditional
  assert.equal(wrappedResult.kind, "conditional")
  assert.equal(((wrappedResult.check as Type.TupleType).items[0] as Type.Union).members.length, 2)
})

test("conditionals bind infer variables against the checked type", () => {
  const T = Type.param("T")
  const U = Type.param("U")
  const Unwrap = Type.conditional(T, Type.promise(Type.infer("U")), U, T)
  const params = [T] as const

  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [Promise<number>]>>().toEqualTypeOf<number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [string]>>().toEqualTypeOf<string>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [Promise<number> | boolean]>>().toEqualTypeOf<number | boolean>()

  const field = Type.conditional(T, Type.object({ value: Type.infer("V") }), Type.param("V"), Type.never)
  expectTypeOf<Type.Substitute<Type.Denotes<typeof field>, [typeof T], [{ value: boolean; other: 1 }]>>().toEqualTypeOf<boolean>()
  expectTypeOf<Equal<Type.Substitute<Type.Denotes<typeof field>, [typeof T], [string]>, never>>().toEqualTypeOf<true>()

  const pair = Type.conditional(T, Type.tuple(Type.infer("A"), Type.infer("B")), Type.tuple(Type.param("B"), Type.param("A")), Type.never)
  expectTypeOf<Type.Substitute<Type.Denotes<typeof pair>, [typeof T], [[1, "x"]]>>().toEqualTypeOf<["x", 1]>()

  const element = Type.conditional(T, Type.array(Type.infer("E")), Type.param("E"), T)
  expectTypeOf<Type.Substitute<Type.Denotes<typeof element>, [typeof T], [string[]]>>().toEqualTypeOf<string>()

  const wrapped = Type.conditional(Type.tuple(T), Type.tuple(Type.string), Type.literal(true), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof wrapped>, [typeof T], [string | number]>>().toEqualTypeOf<false>()

  const concreteInfer = Type.conditional(
    Type.union(Type.promise(Type.number), Type.boolean),
    Type.promise(Type.infer("U")),
    Type.param("U"),
    Type.literal(false),
  )
  expectTypeOf<Type.Denotes<typeof concreteInfer>>().toEqualTypeOf<false>()

  const objectInfer = Type.conditional(T, Type.object({ x: Type.infer("U") }), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof objectInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()
  const tupleInfer = Type.conditional(T, Type.tuple(Type.infer("U")), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof tupleInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown>()
  const functionInfer = Type.conditional(T, Type.fn([Type.infer("U")], Type.any), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof functionInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown>()
  const returnInfer = Type.conditional(T, Type.fn([], Type.infer("U"), Type.any), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof returnInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()
  const promiseInfer = Type.conditional(T, Type.promise(Type.infer("U")), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof promiseInfer>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()

  const ordinaryAny = Type.conditional(T, Type.string, Type.literal(true), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof ordinaryAny>, [typeof T], [any]>>().toEqualTypeOf<true | false>()

  const repeatedTuple = Type.conditional(T, Type.tuple(Type.infer("U"), Type.infer("U")), Type.param("U"), Type.literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedTuple>, [typeof T], [[string, number]]>>().toEqualTypeOf<string | number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedTuple>, [typeof T], [any]>>().toEqualTypeOf<unknown>()

  const repeatedObject = Type.conditional(
    T,
    Type.object({ a: Type.infer("U"), b: Type.infer("U") }),
    Type.param("U"),
    Type.literal(false),
  )
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedObject>, [typeof T], [{ a: string; b: number }]>>()
    .toEqualTypeOf<string | number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedObject>, [typeof T], [any]>>().toEqualTypeOf<unknown | false>()

  const repeatedFunction = Type.conditional(
    T,
    Type.fn([Type.infer("U"), Type.infer("U")], Type.void),
    Type.param("U"),
    Type.literal(false),
  )
  type RepeatedFunctionResult = Type.Substitute<Type.Denotes<typeof repeatedFunction>, [typeof T], [(a: string, b: number) => void]>
  expectTypeOf<Equal<RepeatedFunctionResult, never>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedFunction>, [typeof T], [any]>>().toEqualTypeOf<unknown>()

  const nestedFunction = Type.conditional(
    T,
    Type.fn(
      [Type.fn([Type.infer("U")], Type.void), Type.fn([Type.infer("U")], Type.void)],
      Type.void,
    ),
    Type.param("U"),
    Type.literal(false),
  )
  expectTypeOf<
    Type.Substitute<Type.Denotes<typeof nestedFunction>, [typeof T], [(a: (x: string) => void, b: (x: number) => void) => void]>
  >().toEqualTypeOf<string | number>()

  const mixedVariance = Type.conditional(
    T,
    Type.object({ value: Type.infer("U"), consume: Type.fn([Type.infer("U")], Type.void) }),
    Type.param("U"),
    Type.literal(false),
  )
  type MixedVarianceResult = Type.Substitute<
    Type.Denotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: number) => void }]
  >
  const mixedConflict: MixedVarianceResult = false
  void mixedConflict
  type MixedSame = Type.Substitute<
    Type.Denotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: string) => void }]
  >
  expectTypeOf<Equal<MixedSame, string>>().toEqualTypeOf<true>()
  type MixedCovariantSubtype = Type.Substitute<
    Type.Denotes<typeof mixedVariance>,
    [typeof T],
    [{ value: "x"; consume: (x: string) => void }]
  >
  const mixedCovariantSubtype: MixedCovariantSubtype = "x"
  void mixedCovariantSubtype
  type MixedContravariantSubtype = Type.Substitute<
    Type.Denotes<typeof mixedVariance>,
    [typeof T],
    [{ value: string; consume: (x: "x") => void }]
  >
  const mixedContravariantSubtype: MixedContravariantSubtype = false
  void mixedContravariantSubtype

  expectTypeOf<Type.Abstract<Type.Denotes<typeof Unwrap>>>().toEqualTypeOf<true>()
  void params
})

test("a declared generic with infer resolves when applied", () => {
  const T = Type.param("T")
  let Resolved!: Type.TypeRef<any>
  Program.build(function*() {
    const Unwrap = yield* Decl.type("Unwrap", {
      params: [T],
      body: Type.conditional(T, Type.promise(Type.infer("U")), Type.param("U"), T),
    })
    const applied = Type.apply(Unwrap, [Type.promise(Type.number)])
    expectTypeOf<Type.Denotes<typeof applied>>().toEqualTypeOf<number>()
    Resolved = yield* Decl.type("Resolved", applied)
    return null
  })
  assert.equal(Resolved.nameHint, "Resolved")
})

test("a host generic stays symbolic until its argument is concrete", () => {
  const T = Type.param("T")
  Program.build(function*() {
    const Wrap = yield* Decl.type("Wrap", { params: [T], body: Type.promise(T) })
    const applied = Type.apply(Wrap, [Type.number])
    expectTypeOf<Type.Denotes<typeof applied>>().toEqualTypeOf<Promise<number>>()
    const Twice = yield* Decl.type("Twice", { params: [T], body: Type.apply(Wrap, [Type.apply(Wrap, [T])]) })
    const twice = Type.apply(Twice, [Type.string])
    expectTypeOf<Type.Denotes<typeof twice>>().toEqualTypeOf<Promise<Promise<string>>>()
    return null
  })
  expectTypeOf<Type.Abstract<Type.Denotes<ReturnType<typeof Type.promise<typeof T>>>>>().toEqualTypeOf<true>()
})

test("Abstract only fires for unresolved symbolic information", () => {
  expectTypeOf<Type.Abstract<[unknown, Type.Variable<"T">]>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<{ a: unknown; b: Type.Variable<"T"> }>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<[unknown, string]>>().toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<Promise<number>>>().toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<(x: Type.Variable<"T">) => void>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<Type.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<string>>().toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<{ a: string }>>().toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<string | Type.Variable<"T">>>().toEqualTypeOf<true>()
  expectTypeOf<{ x: 1 } extends Type.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends Type.Generic<any, any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{} extends Type.Variable<any> ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<{ x: 1 } extends Type.Op<any, any> ? true : false>().toEqualTypeOf<false>()
})

test("Instantiate substitutes through operator nodes at runtime", () => {
  const T = Type.param("T")
  let instantiated!: Expr.Instantiation<any, any, any, any>
  Program.build(function*() {
    const keys = yield* fn("keys", {
      typeParams: [T],
      params: [Expr.param("value", T)],
      returns: Type.keyof(T),
      body: function*({ value }) {
        return value as never
      },
    })
    instantiated = Expr.instantiate(keys, Type.object({ a: Type.number }))
    return null
  })
  const signature = instantiated.type as Type.FunctionType
  const returned = signature.return as Type.KeyOf
  assert.equal(returned.kind, "keyof")
  assert.equal((returned.operand as Type.Any).kind, "object")
})

test("a type alias identity is declared once per program", () => {
  const alias = Decl.type("Id", Type.string)
  assert.throws(
    () =>
      Program.build(function*() {
        yield* alias
        yield* alias
        return null
      }),
    /declared more than once with the same identity/,
  )
})

test("a type reference must resolve to an in-scope alias", () => {
  const alias = Program.build(function*() {
    return yield* Decl.type("Missing", Type.string)
  }).result
  assert.throws(
    () =>
      Program.build(function*() {
        yield* Decl.const("id", "a", alias)
        return null
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("a reference to a host type emits its name", () => {
  const Custom = FFI.Type<{ readonly custom: true }>("MyCustomType")
  const program = Program.build(function*() {
    yield* fn("process", {
      params: [Expr.param("x", Custom)],
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
  const record = Type.external("Record", Type.literal("name"), Type.unknown)
  assert.equal(propType(record, "name"), Type.unknown)
  assert.equal(propType(record, "other"), undefined)
  const object = Type.object({ name: Type.string, count: Type.number })
  assert.equal(propType(Type.intersection(object, record), "name"), Type.string)
  assert.equal(propType(Type.intersection(object, record), "count"), Type.number)
  assert.equal(propType(Type.intersection(Type.object({ id: Type.number }), record), "name"), Type.unknown)
  assert.equal(propType(Type.intersection(object, Type.object({ name: Type.number })), "name"), undefined)
})
