import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Std from "../src/std/index.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram as emitProgramBabel } from "../targets/babel/index.ts"
import { emitProgram as emitProgramTypeScript } from "../targets/typescript/index.ts"
import { type Equal, expectTypeOf } from "./typing.ts"

interface Spelled {
  readonly text: string
  readonly babel: string
}

/** emits `type T = body` through both emitters and returns the text after `= ` */
const spell = (body: Type.TypeExpr<any>, params: Type.AnyParams = []): Spelled => {
  const program = Program.build(function*() {
    yield* Type.Type("T").pipe(Type.TypeParams(...params), Type.Body(body))
    return null
  })
  const strip = (code: string): string => code.replace(/^type T(<[^>]*>)? = /, "").replace(/;$/, "")
  return { text: strip(emitProgramTypeScript(program)), babel: strip(emitProgramBabel(program)) }
}

test("type operators emit the TypeScript you would write by hand", () => {
  const T = Type.Param("T")
  const K = Type.Param("K")
  const obj = Type.Object({ a: Type.Number(), b: Type.String() })

  assert.equal(spell(Type.KeyOf(obj)).text, "keyof { a: number; b: string }")
  assert.equal(spell(Type.KeyOf(obj)).babel, "keyof {\n  a: number;\n  b: string;\n}")
  assert.equal(spell(Type.Index(obj, Type.Literal("a"))).text, "{ a: number; b: string }[\"a\"]")
  assert.equal(spell(Type.Intersection(obj, Type.Object({ c: Type.Boolean() }))).text, "{ a: number; b: string } & { c: boolean }")
  assert.equal(spell(Type.Conditional(T, Type.String(), Type.Literal(true), Type.Literal(false)), [T]).text, "T extends string ? true : false")
  assert.equal(spell(Type.Conditional(T, Type.String(), Type.Literal(true), Type.Literal(false)), [T]).babel, "T extends string ? true : false")
  assert.equal(spell(Type.Mapped("K", T, Type.Index(T, K)), [T]).text, "{ [K in keyof T]: T[K] }")
  assert.equal(spell(Type.Mapped("K", T, Type.Index(T, K)), [T]).babel, "{ [K in keyof T]: T[K] }")
  assert.equal(spell(Type.TemplateLiteral(["id-", ""], Type.Number())).text, "`id-${number}`")
  assert.equal(spell(Type.TemplateLiteral(["id-", ""], Type.Number())).babel, "`id-${number}`")
  assert.equal(
    spell(Type.Conditional(T, Type.Array(Type.InferVar("E")), Type.Param("E"), Type.Never()), [T]).text,
    "T extends (infer E)[] ? E : never",
  )
  assert.equal(
    spell(Type.Conditional(T, Type.Array(Type.InferVar("E")), Type.Param("E"), Type.Never()), [T]).babel,
    "T extends (infer E)[] ? E : never",
  )
})

test("the text emitter parenthesizes types by precedence", () => {
  assert.equal(spell(Type.Array(Type.Union(Type.String(), Type.Number()))).text, "(string | number)[]")
  assert.equal(spell(Type.Array(Type.Number())).text, "number[]")
  assert.equal(spell(Type.Union(Type.Function([], Type.Number()), Type.String())).text, "(() => number) | string")
  assert.equal(spell(Type.Union(Type.Intersection(Type.String(), Type.Number()), Type.Boolean())).text, "string & number | boolean")
  assert.equal(spell(Type.KeyOf(Type.Union(Type.String(), Type.Number()))).text, "keyof (string | number)")
})

test("function types spell a rest parameter", () => {
  const fn = Type.Function([Type.String()], Type.Void(), Type.Array(Type.Number()))
  assert.equal(spell(fn).text, "(arg0: string, ...arg1: number[]) => void")
  assert.equal(spell(fn).babel, "(arg0: string, ...arg1: number[]) => void")
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
  assert.match(emitProgramTypeScript(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
  assert.match(emitProgramBabel(program), /function sum\(first: number, \.\.\.more: number\[\]\)/)
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

  assert.equal(spell(obj).text, "{ readonly id: number; nick?: string; readonly both?: boolean; name: string }")
  assert.equal(spell(obj).babel, "{\n  readonly id: number;\n  nick?: string;\n  readonly both?: boolean;\n  name: string;\n}")

  const program = Program.build(function*() {
    yield* Binding.Let("record").pipe(
      Binding.Init(Expr.Object({ id: Expr.Number(1) })),
      Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()) })),
    )
    return null
  })
  assert.equal(emitProgramTypeScript(program), "let record: { readonly id: number } = { id: 1 };")
})

test("a field modifier outside an object type is rejected at emit", () => {
  assert.throws(() => spell(Type.Readonly(Type.Number())), /field modifier/)
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
  const Promise_ = Std.Promise.Promise
  const Unwrap = Type.Conditional(T, Type.Apply(Promise_, [Type.InferVar("U")]), U, T)
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
    const Unwrap = yield* Type.Type("Unwrap").pipe(
      Type.TypeParams(T),
      Type.Body(Type.Conditional(T, Type.Apply(Std.Promise.Promise, [Type.InferVar("U")]), Type.Param("U"), T)),
    )
    const applied = Type.Apply(Unwrap, [Type.Apply(Std.Promise.Promise, [Type.Number()])])
    expectTypeOf<Type.Denotes<typeof applied>>(null as any).toEqualTypeOf<number>()
    Resolved = yield* Type.Type("Resolved").pipe(Type.Body(applied))
    return null
  })
  assert.equal(Resolved.name, "Resolved")
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
