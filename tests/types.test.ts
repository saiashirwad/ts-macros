import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
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

test("function types spell a rest parameter", () => {
  const fn = Type.Function([Type.String()], Type.Void(), Type.Array(Type.Number()))
  assert.equal(spell(fn), "(arg0: string, ...arg1: number[]) => void")
  expectTypeOf<Type.Denotes<typeof fn>>(null as any).toEqualTypeOf<(arg0: string, ...rest: number[]) => void>()
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
  const emitted = emitProgram(program)
  assert.match(emitted, /function getId\(rec: \{ readonly id: number; nick\?: string \}\): number/)
  assert.match(emitted, /function getNick\(.*\): string \| undefined/)
})

test("template literal types check their arity at construction", () => {
  assert.throws(() => Type.TemplateLiteral(["a", "b", "c"], Type.Literal(1)), /needs 2 parts, got 3/)
})

test("operators over concrete types denote the evaluated type", () => {
  const obj = Type.Object({ name: Type.String(), age: Type.Number() })
  expectTypeOf<Type.Denotes<Type.KeyOf<typeof obj>>>(null as any).toEqualTypeOf<"name" | "age">()
  expectTypeOf<Type.Denotes<Type.IndexedAccess<typeof obj, Type.Literal<"age">>>>(null as any).toEqualTypeOf<number>()
  const literal = Type.TemplateLiteral(["hello-", ""], Type.Literal("world"))
  expectTypeOf<Type.Denotes<typeof literal>>(null as any).toEqualTypeOf<"hello-world">()
  const cond = Type.Conditional(Type.String(), Type.String(), Type.Literal(1), Type.Literal(2))
  expectTypeOf<Type.Denotes<typeof cond>>(null as any).toEqualTypeOf<1>()
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
