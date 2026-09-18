import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
import { substitute } from "../src/types/lattice.ts"
import { emitProgram } from "../targets/typescript/index.ts"
import { type Equal, expectTypeOf } from "./typing.ts"

/** emits `type T = body` and returns the text after `= ` */
const spell = (body: Type.TypeExpr<any>, params: Type.AnyParams = []): string => {
  const program = Program.build(function*() {
    yield* Type.Type("T", body).pipe(Type.TypeParams(...params))
    return null
  })
  return emitProgram(program).replace(/^type T(<[^>]*>)? = /, "").replace(/;$/, "")
}

test("literal types reject non-finite numbers", () => {
  Type.Literal(-0)
  Type.Literal(1.5)

  // `NaN` and infinities have phantom type `number`, not a literal subtype, so
  // runtime construction is the earliest point at which TypeScript can reject them.
  assert.throws(() => Type.Literal(NaN), /literal number must be finite, got NaN/)
  assert.throws(() => Type.Literal(Infinity), /literal number must be finite, got Infinity/)
  assert.throws(() => Type.Literal(-Infinity), /literal number must be finite, got -Infinity/)
})

test("type operators emit the TypeScript you would write by hand", () => {
  const T = Type.Param("T")
  const K = Type.Param("K")
  const obj = Type.Object({ a: Type.Number(), b: Type.String() })

  assert.equal(spell(Type.KeyOf(obj)), "keyof { a: number; b: string }")
  assert.equal(spell(Type.Index(obj, Type.Literal("a"))), "{ a: number; b: string }[\"a\"]")
  assert.equal(spell(Type.Intersection(obj, Type.Object({ c: Type.Boolean() }))), "{ a: number; b: string } & { c: boolean }")
  assert.equal(spell(Type.Conditional(T, Type.String(), Type.Literal(true), Type.Literal(false)), [T]), "T extends string ? true : false")
  assert.equal(spell(Type.Mapped("K", T, Type.Index(T, K)), [T]), "{ [K in keyof T]: T[K] }")
  assert.equal(spell(Type.TemplateLiteral(["id-", ""], Type.Number())), "`id-${number}`")
  assert.equal(
    spell(Type.Conditional(T, Type.Array(Type.InferVar("E")), Type.Param("E"), Type.Never()), [T]),
    "T extends (infer E)[] ? E : never",
  )
})

test("the text emitter parenthesizes types by precedence", () => {
  assert.equal(spell(Type.Array(Type.Union(Type.String(), Type.Number()))), "(string | number)[]")
  assert.equal(spell(Type.Array(Type.Number())), "number[]")
  assert.equal(spell(Type.Union(Type.Function([], Type.Number()), Type.String())), "(() => number) | string")
  assert.equal(spell(Type.Union(Type.Intersection(Type.String(), Type.Number()), Type.Boolean())), "string & number | boolean")
  assert.equal(spell(Type.KeyOf(Type.Union(Type.String(), Type.Number()))), "keyof (string | number)")
})

test("function types accept array, tuple, and constrained symbolic rest types", () => {
  const arrayFn = Type.Function([Type.String()], Type.Void(), Type.Array(Type.Number()))
  assert.equal(spell(arrayFn), "(arg0: string, ...arg1: number[]) => void")
  expectTypeOf<Type.Denotes<typeof arrayFn>>(null as any).toEqualTypeOf<(arg0: string, ...rest: number[]) => void>()

  const tupleFn = Type.Function([], Type.Void(), Type.Tuple(Type.String(), Type.Number()))
  assert.equal(spell(tupleFn), "(...arg0: [string, number]) => void")
  expectTypeOf<Type.Denotes<typeof tupleFn>>(null as any).toEqualTypeOf<(...rest: [string, number]) => void>()

  const constrainedArray = Type.Param("A", Type.Array(Type.Unknown()))
  const arrayGeneric = Type.Function([], Type.Void(), constrainedArray)
  assert.equal(spell(arrayGeneric, [constrainedArray]), "(...arg0: A) => void")

  const constrainedTuple = Type.Param("T", Type.Tuple(Type.String(), Type.Number()))
  const tupleGeneric = Type.Function([], Type.Void(), constrainedTuple)
  assert.equal(spell(tupleGeneric, [constrainedTuple]), "(...arg0: T) => void")
  assert.equal(
    emitProgram(Program.build(function*() {
      yield* Type.Type("RestFunction", tupleGeneric).pipe(Type.TypeParams(constrainedTuple))
      return null
    })),
    "type RestFunction<T extends [string, number]> = (...arg0: T) => void;",
  )

  const readonlyArray = Type.Ref<readonly string[]>("ReadonlyArray", Type.String())
  Type.Function([], Type.Void(), readonlyArray)
  const readonlyTuple = Type.Ref<readonly [string, number]>("ReadonlyPair")
  Type.Function([], Type.Void(), readonlyTuple)
  const anyFn = Type.Function([], Type.Void(), Type.Any())
  assert.equal(spell(anyFn), "(...arg0: any) => void")

  // @ts-expect-error - a primitive cannot be used as a function rest type
  Type.Function([], Type.Void(), Type.Number())
  // @ts-expect-error - an object cannot be used as a function rest type
  Type.Function([], Type.Void(), Type.Object({ value: Type.Number() }))
  // @ts-expect-error - an unconstrained symbolic type is not proven array-like
  Type.Function([], Type.Void(), Type.Param("R"))
  // @ts-expect-error - a symbolic type constrained to a primitive is not array-like
  Type.Function([], Type.Void(), Type.Param("R", Type.Number()))
  // @ts-expect-error - TypeScript does not allow `T extends any` as a rest type
  Type.Function([], Type.Void(), Type.Param("R", Type.Any()))
})

test("a declared rest parameter shows up in the inferred signature", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("sum").pipe(
      Fn.Params(Fn.Param("first", Type.Number()), Fn.Rest("more", Type.Number())),
      Fn.Impl(function*({ first }) {
        return first
      }),
    )
    return null
  })
  const signature = (program.statements[0] as Fn.FunctionDeclaration).type as Type.FunctionType
  assert.equal(signature.params.length, 1)
  assert.equal((signature.rest as Type.Any).tag, "array")
  assert.match(emitProgram(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
})

test("object field modifiers show up on the phantom and in emit", () => {
  const obj = Type.Object({
    id: Type.Readonly(Type.Number()),
    nick: Type.Optional(Type.String()),
    both: Type.Readonly(Type.Optional(Type.Boolean())),
    name: Type.String(),
  })
  expectTypeOf<Type.Denotes<typeof obj>>(null as any).toEqualTypeOf<
    { readonly id: number; nick?: string; readonly both?: boolean; name: string }
  >()

  assert.equal(spell(obj), "{ readonly id: number; nick?: string; readonly both?: boolean; name: string }")

  const program = Program.build(function*() {
    yield* Binding.Let("record").pipe(
      Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()) })),
      Binding.Init(Expr.Object({ id: Expr.Number(1) })),
    )
    return null
  })
  assert.equal(emitProgram(program), "let record: { readonly id: number } = { id: 1 };")
})

test("type parameter names are distinct", () => {
  const T = Type.Param("T")
  const U = Type.Param("U")
  const V = Type.Param("V")

  Type.Type("Pair", Type.Tuple(T, U)).pipe(Type.TypeParams(T, U))
  Fn.Function("pick").pipe(
    Fn.TypeParams(T, U, V),
    Fn.Impl(function*() {
      return Expr.Number(1)
    }),
  )

  // @ts-expect-error - adjacent type parameters cannot have the same name
  Type.Type("Bad", T).pipe(Type.TypeParams(T, Type.Param("T")))
  // @ts-expect-error - nonadjacent type parameters cannot have the same name
  Type.Type("Bad", T).pipe(Type.TypeParams(T, U, Type.Param("T")))
  // @ts-expect-error - adjacent function type parameters cannot have the same name
  Fn.Function("bad").pipe(Fn.TypeParams(T, Type.Param("T")))
  // @ts-expect-error - nonadjacent function type parameters cannot have the same name
  Fn.Function("bad").pipe(Fn.TypeParams(T, U, Type.Param("T")))

  const duplicateTypeStep = Type.TypeParams(T, U, Type.Param("T"))
  // @ts-expect-error - a saved type declaration step is checked when applied
  Type.Type("Bad", T).pipe(duplicateTypeStep)
  const duplicateFnStep = Fn.TypeParams(T, U, Type.Param("T"))
  // @ts-expect-error - a saved function declaration step is checked when applied
  Fn.Function("bad").pipe(duplicateFnStep)
})

test("a field modifier is not a type, so it compiles only as a field of an object type", () => {
  // @ts-expect-error - an element is a type
  Type.Array(Type.Readonly(Type.Number()))
  // @ts-expect-error - a union member is a type
  Type.Union(Type.Optional(Type.Number()), Type.String())
  // @ts-expect-error - a param's type is a type
  Fn.Param("p", Type.Optional(Type.Number()))
  // @ts-expect-error - a type alias's body is a type
  Type.Type("T", Type.Readonly(Type.Number()))
})

test("reading a field gives the field's type, without its modifiers", () => {
  const Rec = Type.Object({ id: Type.Readonly(Type.Number()), nick: Type.Optional(Type.String()) })
  const program = Program.build(function*() {
    yield* Fn.Function("getId").pipe(
      Fn.Params(Fn.Param("rec", Rec)),
      Fn.Impl(function*({ rec }) {
        return Expr.Prop(rec, "id")
      }),
    )
    yield* Fn.Function("getNick").pipe(
      Fn.Params(Fn.Param("rec", Rec)),
      Fn.Impl(function*({ rec }) {
        const nick = Expr.Prop(rec, "nick")
        expectTypeOf<Expr.Denotes<typeof nick>>(null as any).toEqualTypeOf<string | undefined>()
        return nick
      }),
    )
    return null
  })
  const returned = (statement: unknown): Type.Any => ((statement as Fn.FunctionDeclaration).type as Type.FunctionType).return as Type.Any
  const [getId, getNick] = program.statements
  assert.equal((returned(getId) as Type.Primitive).name, "number")
  const nick = returned(getNick) as Type.Union
  assert.deepEqual(nick.members.map((member) => (member as Type.Primitive).name), ["string", "undefined"])
  assert.match(emitProgram(program), /function getId\(rec: \{ readonly id: number; nick\?: string \}\) \{/)
})

test("template literal types accept TypeScript's interpolation primitives", () => {
  const primitives = Type.TemplateLiteral(
    ["s:", ",n:", ",b:", ",bool:", ",null:", ",undefined:", ""],
    Type.Literal("x"),
    Type.Literal(1),
    Type.Ref<2n>("Big"),
    Type.Literal(true),
    Type.Null(),
    Type.Undefined(),
  )
  expectTypeOf<Type.Denotes<typeof primitives>>(null as any).toEqualTypeOf<"s:x,n:1,b:2,bool:true,null:null,undefined:undefined">()
  assert.equal(spell(primitives), "`s:${\"x\"},n:${1},b:${Big},bool:${true},null:${null},undefined:${undefined}`")

  const crossProduct = Type.TemplateLiteral(
    ["", "-", ""],
    Type.Union(Type.Literal("a"), Type.Literal("b")),
    Type.Union(Type.Literal(1), Type.Literal(2)),
  )
  expectTypeOf<Type.Denotes<typeof crossProduct>>(null as any).toEqualTypeOf<"a-1" | "a-2" | "b-1" | "b-2">()
  assert.equal(spell(crossProduct), "`${\"a\" | \"b\"}-${1 | 2}`")

  const T = Type.Param("T", Type.Union(Type.String(), Type.Number()))
  const symbolic = Type.TemplateLiteral(["value-", ""], T)
  expectTypeOf<Type.Abstract<Type.Denotes<typeof symbolic>>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof symbolic>, [typeof T], ["x" | 1]>>(null as any).toEqualTypeOf<"value-x" | "value-1">()
  assert.equal(spell(symbolic, [T]), "`value-${T}`")
})

test("template literal types check their arity and interpolation types", () => {
  assert.throws(() => Type.TemplateLiteral(["a", "b", "c"], Type.Literal(1)), /needs 2 parts, got 3/)
  Type.TemplateLiteral(["", ""], Type.Param("Text", Type.String()))
  Type.TemplateLiteral(["", ""], Type.Param("Anything", Type.Any()))
  const Nothing = Type.Param("Nothing", Type.Never())
  Type.TemplateLiteral(["", ""], Nothing)
  Type.TemplateLiteral(["", ""], Type.Ref<string | number>("StringOrNumber"))
  const Base = Type.Param("Base", Type.String())
  Type.TemplateLiteral(["", ""], Type.Param("Dependent", Base))
  // @ts-expect-error - an unconstrained type parameter is not proven interpolable
  Type.TemplateLiteral(["", ""], Type.Param("T"))
  // @ts-expect-error - an unknown constraint is not proven interpolable
  Type.TemplateLiteral(["", ""], Type.Param("T", Type.Unknown()))
  // @ts-expect-error - an object constraint is not interpolable
  Type.TemplateLiteral(["", ""], Type.Param("T", Type.Object({ value: Type.Number() })))
  // @ts-expect-error - object types cannot be template literal interpolations
  Type.TemplateLiteral(["", ""], Type.Object({ value: Type.Number() }))
  // @ts-expect-error - object reference phantoms cannot be template literal interpolations
  Type.TemplateLiteral(["", ""], Type.Ref<{ value: number }>("RecordType"))
  // @ts-expect-error - symbol cannot be a template literal interpolation
  Type.TemplateLiteral(["", ""], Type.Ref<symbol>("SymbolType"))
})

test("operators over concrete types denote the evaluated type", () => {
  const obj = Type.Object({ name: Type.String(), age: Type.Number() })
  expectTypeOf<Type.Denotes<Type.KeyOf<typeof obj>>>(null as any).toEqualTypeOf<"name" | "age">()
  expectTypeOf<Type.Denotes<Type.IndexedAccess<typeof obj, Type.Literal<"age">>>>(null as any).toEqualTypeOf<number>()
  const literal = Type.TemplateLiteral(["hello-", ""], Type.Literal("world"))
  expectTypeOf<Type.Denotes<typeof literal>>(null as any).toEqualTypeOf<"hello-world">()
  const cond = Type.Conditional(Type.String(), Type.String(), Type.Literal(1), Type.Literal(2))
  expectTypeOf<Type.Denotes<typeof cond>>(null as any).toEqualTypeOf<1>()
  const concreteUnion = Type.Conditional(Type.Union(Type.String(), Type.Number()), Type.String(), Type.Literal(1), Type.Literal(2))
  expectTypeOf<Type.Denotes<typeof concreteUnion>>(null as any).toEqualTypeOf<2>()
})

test("mapped substitution keeps positional args aligned when its key shadows a param", () => {
  const key = Type.Param("K")
  const source = Type.Param("S")
  const value = Type.Param("V")
  const body = Type.Object({ source, value })

  const keyFirst = substitute(
    Type.Mapped("K", source, body),
    [key, source, value],
    [Type.Literal("shadowed"), Type.String(), Type.Number()],
  ) as Type.Mapped
  assert.equal((keyFirst.source as Type.Primitive).name, "string")
  assert.deepEqual(
    Object.fromEntries(
      Object.entries((keyFirst.body as Type.Object).fields).map(([name, field]) => [name, (Type.fieldOf(field).type as Type.Primitive).name]),
    ),
    { source: "string", value: "number" },
  )

  const keyMiddle = substitute(
    Type.Mapped("K", source, body),
    [source, key, value],
    [Type.String(), Type.Literal("shadowed"), Type.Number()],
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
  expectTypeOf<And>(null as any).toEqualTypeOf<Type.Op<"and", [Type.Variable<"T">, "right"]>>()
  expectTypeOf<Type.Substitute<And, [Type.Param<"T", any>], [false]>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Type.Substitute<And, [Type.Param<"T", any>], [true]>>(null as any).toEqualTypeOf<"right">()
  expectTypeOf<Type.Substitute<Or, [Type.Param<"T", any>], [unknown]>>(null as any).toEqualTypeOf<{}>()
  type AndNever = Type.LogicalDenote<"and", never, "right">
  type OrNever = Type.LogicalDenote<"or", never, "right">
  expectTypeOf<Equal<AndNever, never>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Equal<OrNever, never>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Equal<Type.LogicalDenote<"and", unknown, "right">, unknown>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.LogicalDenote<"or", unknown, "right">>(null as any).toEqualTypeOf<{}>()
  expectTypeOf<Type.LogicalDenote<"and", number, "right">>(null as any).toEqualTypeOf<0 | "right">()
  expectTypeOf<Type.LogicalDenote<"or", number, "right">>(null as any).toEqualTypeOf<number | "right">()
})

test("Substitute reduces symbolic operators once generic args arrive", () => {
  type CondBody = Type.Op<"cond", [Type.Variable<"T">, string, Type.Variable<"T">, never]>
  expectTypeOf<Type.Substitute<CondBody, [Type.Param<"T", any>], [string]>>(null as any).toEqualTypeOf<string>()
  type SubNull = Type.Substitute<CondBody, [Type.Param<"T", any>], [null]>
  expectTypeOf<Equal<SubNull, never>>(null as any).toEqualTypeOf<true>()

  type IndexBody = Type.Op<"index", [{ name: string; age: number }, Type.Variable<"K">]>
  expectTypeOf<Type.Substitute<IndexBody, [Type.Param<"K", any>], ["name"]>>(null as any).toEqualTypeOf<string>()

  type MappedBody = Type.Op<"mapped", [{ a: string; b: number }, Type.Op<"index", [{ a: string; b: number }, Type.Variable<"K">]>, "K"]>
  expectTypeOf<Type.Substitute<MappedBody, [], []>>(null as any).toEqualTypeOf<{ a: string; b: number }>()
})

test("conditional AST substitution preserves naked and wrapped checks", () => {
  const T = Type.Param("T")
  const concrete = Type.Conditional(Type.Union(Type.String(), Type.Number()), Type.String(), Type.Literal(1), Type.Literal(2))
  const concreteResult = substitute(concrete, [], []) as Type.Conditional
  assert.equal(concreteResult.tag, "conditional")
  assert.equal((concreteResult.check as Type.Union).members.length, 2)

  const naked = Type.Conditional(T, Type.String(), Type.Literal(1), Type.Literal(2))
  const nakedResult = substitute(naked, [T], [Type.Union(Type.String(), Type.Number())]) as Type.Conditional
  assert.equal(nakedResult.tag, "conditional")
  assert.equal((nakedResult.check as Type.Union).members.length, 2)

  const wrapped = Type.Conditional(Type.Tuple(T), Type.Tuple(Type.String()), Type.Literal(1), Type.Literal(2))
  const wrappedResult = substitute(wrapped, [T], [Type.Union(Type.String(), Type.Number())]) as Type.Conditional
  assert.equal(wrappedResult.tag, "conditional")
  assert.equal(((wrappedResult.check as Type.TupleType).items[0] as Type.Union).members.length, 2)
})

test("conditionals bind infer variables against the checked type", () => {
  const T = Type.Param("T")
  const U = Type.Param("U")
  const Unwrap = Type.Conditional(T, Type.Promise(Type.InferVar("U")), U, T)
  const params = [T] as const

  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [Promise<number>]>>(null as any).toEqualTypeOf<number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [string]>>(null as any).toEqualTypeOf<string>()
  // distributes over a union, like TypeScript
  expectTypeOf<Type.Substitute<Type.Denotes<typeof Unwrap>, [typeof T], [Promise<number> | boolean]>>(null as any).toEqualTypeOf<number | boolean>()

  const field = Type.Conditional(T, Type.Object({ value: Type.InferVar("V") }), Type.Param("V"), Type.Never())
  expectTypeOf<Type.Substitute<Type.Denotes<typeof field>, [typeof T], [{ value: boolean; other: 1 }]>>(null as any).toEqualTypeOf<boolean>()
  expectTypeOf<Equal<Type.Substitute<Type.Denotes<typeof field>, [typeof T], [string]>, never>>(null as any).toEqualTypeOf<true>()

  const pair = Type.Conditional(T, Type.Tuple(Type.InferVar("A"), Type.InferVar("B")), Type.Tuple(Type.Param("B"), Type.Param("A")), Type.Never())
  expectTypeOf<Type.Substitute<Type.Denotes<typeof pair>, [typeof T], [[1, "x"]]>>(null as any).toEqualTypeOf<["x", 1]>()

  const element = Type.Conditional(T, Type.Array(Type.InferVar("E")), Type.Param("E"), T)
  expectTypeOf<Type.Substitute<Type.Denotes<typeof element>, [typeof T], [string[]]>>(null as any).toEqualTypeOf<string>()

  const wrapped = Type.Conditional(Type.Tuple(T), Type.Tuple(Type.String()), Type.Literal(true), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof wrapped>, [typeof T], [string | number]>>(null as any).toEqualTypeOf<false>()

  const concreteInfer = Type.Conditional(
    Type.Union(Type.Promise(Type.Number()), Type.Boolean()),
    Type.Promise(Type.InferVar("U")),
    Type.Param("U"),
    Type.Literal(false),
  )
  expectTypeOf<Type.Denotes<typeof concreteInfer>>(null as any).toEqualTypeOf<false>()

  const objectInfer = Type.Conditional(T, Type.Object({ x: Type.InferVar("U") }), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof objectInfer>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown | false>()
  const tupleInfer = Type.Conditional(T, Type.Tuple(Type.InferVar("U")), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof tupleInfer>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown>()
  const functionInfer = Type.Conditional(T, Type.Function([Type.InferVar("U")], Type.Any()), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof functionInfer>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown>()
  const returnInfer = Type.Conditional(T, Type.Function([], Type.InferVar("U"), Type.Any()), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof returnInfer>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown | false>()
  const promiseInfer = Type.Conditional(T, Type.Promise(Type.InferVar("U")), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof promiseInfer>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown | false>()

  const ordinaryAny = Type.Conditional(T, Type.String(), Type.Literal(true), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof ordinaryAny>, [typeof T], [any]>>(null as any).toEqualTypeOf<true | false>()

  const repeatedTuple = Type.Conditional(T, Type.Tuple(Type.InferVar("U"), Type.InferVar("U")), Type.Param("U"), Type.Literal(false))
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedTuple>, [typeof T], [[string, number]]>>(null as any).toEqualTypeOf<string | number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedTuple>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown>()

  const repeatedObject = Type.Conditional(
    T,
    Type.Object({ a: Type.InferVar("U"), b: Type.InferVar("U") }),
    Type.Param("U"),
    Type.Literal(false),
  )
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedObject>, [typeof T], [{ a: string; b: number }]>>(null as any)
    .toEqualTypeOf<string | number>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedObject>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown | false>()

  const repeatedFunction = Type.Conditional(
    T,
    Type.Function([Type.InferVar("U"), Type.InferVar("U")], Type.Void()),
    Type.Param("U"),
    Type.Literal(false),
  )
  type RepeatedFunctionResult = Type.Substitute<Type.Denotes<typeof repeatedFunction>, [typeof T], [(a: string, b: number) => void]>
  expectTypeOf<Equal<RepeatedFunctionResult, never>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Substitute<Type.Denotes<typeof repeatedFunction>, [typeof T], [any]>>(null as any).toEqualTypeOf<unknown>()

  const nestedFunction = Type.Conditional(
    T,
    Type.Function(
      [Type.Function([Type.InferVar("U")], Type.Void()), Type.Function([Type.InferVar("U")], Type.Void())],
      Type.Void(),
    ),
    Type.Param("U"),
    Type.Literal(false),
  )
  expectTypeOf<
    Type.Substitute<Type.Denotes<typeof nestedFunction>, [typeof T], [(a: (x: string) => void, b: (x: number) => void) => void]>
  >(null as any).toEqualTypeOf<string | number>()

  const mixedVariance = Type.Conditional(
    T,
    Type.Object({ value: Type.InferVar("U"), consume: Type.Function([Type.InferVar("U")], Type.Void()) }),
    Type.Param("U"),
    Type.Literal(false),
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
  expectTypeOf<Equal<MixedSame, string>>(null as any).toEqualTypeOf<true>()
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

  // until the argument arrives the conditional stays symbolic
  expectTypeOf<Type.Abstract<Type.Denotes<typeof Unwrap>>>(null as any).toEqualTypeOf<true>()
  void params
})

test("a declared generic with infer resolves when applied", () => {
  const T = Type.Param("T")
  let Resolved!: Type.TypeRef<any>
  Program.build(function*() {
    const Unwrap = yield* Type.Type("Unwrap", Type.Conditional(T, Type.Promise(Type.InferVar("U")), Type.Param("U"), T)).pipe(Type.TypeParams(T))
    const applied = Type.Apply(Unwrap, [Type.Promise(Type.Number())])
    expectTypeOf<Type.Denotes<typeof applied>>(null as any).toEqualTypeOf<number>()
    Resolved = yield* Type.Type("Resolved", applied)
    return null
  })
  assert.equal(Resolved.name, "Resolved")
})

test("a host generic stays symbolic until its argument is concrete", () => {
  const T = Type.Param("T")
  Program.build(function*() {
    // type Wrap<T> = Promise<T>
    const Wrap = yield* Type.Type("Wrap", Type.Promise(T)).pipe(Type.TypeParams(T))
    const applied = Type.Apply(Wrap, [Type.Number()])
    expectTypeOf<Type.Denotes<typeof applied>>(null as any).toEqualTypeOf<Promise<number>>()
    // and through two layers
    const Twice = yield* Type.Type("Twice", Type.Apply(Wrap, [Type.Apply(Wrap, [T])])).pipe(Type.TypeParams(T))
    const twice = Type.Apply(Twice, [Type.String()])
    expectTypeOf<Type.Denotes<typeof twice>>(null as any).toEqualTypeOf<Promise<Promise<string>>>()
    return null
  })
  expectTypeOf<Type.Abstract<Type.Denotes<ReturnType<typeof Type.Promise<typeof T>>>>>(null as any).toEqualTypeOf<true>()
})

test("Abstract only fires for unresolved symbolic information", () => {
  // an unknown member must not hide a variable next to it
  expectTypeOf<Type.Abstract<[unknown, Type.Variable<"T">]>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<{ a: unknown; b: Type.Variable<"T"> }>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<[unknown, string]>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<Promise<number>>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<(x: Type.Variable<"T">) => void>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<Type.Variable<"T">>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Type.Abstract<string>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<{ a: string }>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Type.Abstract<string | Type.Variable<"T">>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<{ x: 1 } extends Type.Generic<any, any> ? true : false>(null as any).toEqualTypeOf<false>()
  // the symbolic markers are required keys, so not even an empty object passes for one
  expectTypeOf<{} extends Type.Generic<any, any> ? true : false>(null as any).toEqualTypeOf<false>()
  expectTypeOf<{} extends Type.Variable<any> ? true : false>(null as any).toEqualTypeOf<false>()
  expectTypeOf<{ x: 1 } extends Type.Op<any, any> ? true : false>(null as any).toEqualTypeOf<false>()
})

test("Instantiate substitutes through operator nodes at runtime", () => {
  const T = Type.Param("T")
  let instantiated!: Fn.Instantiation<any, any, any, any>
  Program.build(function*() {
    const keys = yield* Fn.Function("keys").pipe(
      Fn.TypeParams(T),
      Fn.Params(Fn.Param("value", T)),
      Fn.Returns(Type.KeyOf(T)),
      Fn.Impl(function*({ value }) {
        return value as never
      }),
    )
    instantiated = Fn.Instantiate(keys, Type.Object({ a: Type.Number() }))
    return null
  })
  const signature = instantiated.type as Type.FunctionType
  const returned = signature.return as Type.KeyOf
  assert.equal(returned.tag, "keyof")
  assert.equal((returned.operand as Type.Any).tag, "object")
})

test("a reference to a host type emits its name", () => {
  const Custom = Type.Ref("MyCustomType")
  const program = Program.build(function*() {
    yield* Fn.Function("process").pipe(
      Fn.Params(Fn.Param("x", Custom)),
      Fn.Returns(Custom),
      Fn.Impl(function*({ x }) {
        return x
      }),
    )
    return null
  })
  assert.match(emitProgram(program), /function process\(x: MyCustomType\): MyCustomType/)
})
