import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"
import type { Abstract, Op, Substitute } from "./types/machinery.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const expectTypeOf = <T>(_value: T) => ({
  toEqualTypeOf: <U>(..._args: Equal<T, U> extends true ? [] : ["Type mismatch"]) => {},
})

test("the type-level vocabulary emits the types you'd write by hand", () => {
  const program = Program.build(function*() {
    const NonNull = yield* $.type(["T"], (T) => $.cond(T, $.T.null, $.T.never, T))
    const PickName = yield* $.type(["T"], (T) => $.index(T, "name"))
    const Keys = yield* $.type(["T"], (T) => $.keyof(T))
    const Boxed = yield* $.type(["T"], (T) => $.mapped("K", T, (K) => $.index(T, K)))
    const Label = yield* $.type(["T"], (T) => $.tmpl`hello-${T}`)
    const First = yield* $.type(["T"], (T) => $.elementOf(T))
    void NonNull
    void PickName
    void Keys
    void Boxed
    void Label
    void First
    return 0
  })
  assert.equal(
    emitProgram(program),
    [
      "type NonNull<T> = T extends null ? never : T;",
      "type PickName<T> = T[\"name\"];",
      "type Keys<T> = keyof T;",
      "type Boxed<T> = { [K in keyof T]: T[K] };",
      "type Label<T> = `hello-${T}`;",
      "type First<T> = T extends (infer E)[] ? E : never;",
    ].join("\n"),
  )
})

test("eager operators reduce with TypeScript itself", () => {
  const name = $.index({ name: $.T.string, age: $.T.number }, "name")
  expectTypeOf<Type.Denotes<typeof name>>(null as any).toEqualTypeOf<string>()

  const keys = $.keyof({ name: $.T.string, age: $.T.number })
  expectTypeOf<Type.Denotes<typeof keys>>(null as any).toEqualTypeOf<"name" | "age">()

  const yes = $.cond($.T.string, $.T.string, "yes", "no")
  expectTypeOf<Type.Denotes<typeof yes>>(null as any).toEqualTypeOf<"yes">()

  const no = $.cond($.T.number, $.T.string, "yes", "no")
  expectTypeOf<Type.Denotes<typeof no>>(null as any).toEqualTypeOf<"no">()

  const first = $.elementOf($.arrayOf($.T.string))
  expectTypeOf<Type.Denotes<typeof first>>(null as any).toEqualTypeOf<string>()

  const awaited = $.awaitedOf(Type.Ref<Promise<number>>("Promise", $.T.number))
  expectTypeOf<Type.Denotes<typeof awaited>>(null as any).toEqualTypeOf<number>()

  const returned = $.returnOf($.fnType([$.T.string], $.T.number))
  expectTypeOf<Type.Denotes<typeof returned>>(null as any).toEqualTypeOf<number>()

  const params = $.parametersOf($.fnType([$.T.string], $.T.number))
  expectTypeOf<Type.Denotes<typeof params>>(null as any).toEqualTypeOf<[string]>()

  const literal = $.tmpl(["hello-", ""], "world")
  expectTypeOf<Type.Denotes<typeof literal>>(null as any).toEqualTypeOf<"hello-world">()
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

  const program = Program.build(function*() {
    const Fields = yield* $.type(obj)
    void Fields
    return 0
  })
  assert.equal(
    emitProgram(program),
    "type Fields = {\n  readonly id: number;\n  nick?: string;\n  readonly both?: boolean;\n  name: string;\n};",
  )
})

test("Substitute reduces symbolic operators once generic args arrive", () => {
  type CondBody = Op<"cond", [Type.Variable<"T">, string, Type.Variable<"T">, never]>
  expectTypeOf<Substitute<CondBody, [Type.Param<"T", any>], [string]>>(null as any).toEqualTypeOf<string>()
  expectTypeOf<Substitute<CondBody, [Type.Param<"T", any>], [null]>>(null as any).toEqualTypeOf<never>()

  type IndexBody = Op<"index", [{ name: string; age: number }, Type.Variable<"K">]>
  expectTypeOf<Substitute<IndexBody, [Type.Param<"K", any>], ["name"]>>(null as any).toEqualTypeOf<string>()

  type MappedBody = Op<"mapped", [{ a: string; b: number }, Op<"index", [{ a: string; b: number }, Type.Variable<"K">]>, "K"]>
  expectTypeOf<Substitute<MappedBody, [], []>>(null as any).toEqualTypeOf<{ a: string; b: number }>()
})

test("Abstract only fires for unresolved symbolic information", () => {
  expectTypeOf<Abstract<Type.Variable<"T">>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<Abstract<string>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Abstract<{ a: string }>>(null as any).toEqualTypeOf<false>()
  expectTypeOf<Abstract<string | Type.Variable<"T">>>(null as any).toEqualTypeOf<true>()
  expectTypeOf<{ x: 1 } extends Type.Generic<any, any> ? true : false>(null as any).toEqualTypeOf<false>()
  expectTypeOf<{ x: 1 } extends Op<any, any> ? true : false>(null as any).toEqualTypeOf<false>()
})

test("texpr desugars .prop into indexed access", () => {
  const Person = Type.Object({ name: Type.String(), age: Type.Number() })
  const name = $.tderef($.texpr(Person).name)
  expectTypeOf<Type.Denotes<typeof name>>(null as any).toEqualTypeOf<string>()

  const program = Program.build(function*() {
    const Person = yield* $.type({ name: $.T.string, age: $.T.number })
    const Name = yield* $.type($.texpr(Person).name)
    void Name
    return 0
  })
  assert.equal(emitProgram(program).includes("type Name = Person[\"name\"];"), true)
})

test("names-array $.type keeps apply precise", () => {
  const Result = $.type(["T", "E"], (T, E) => $.union({ ok: true, value: T }, { ok: false, error: E }))
  const applied = $.apply(Result as any, [$.T.string, $.T.number])
  void applied
  const program = Program.build(function*() {
    const Result = yield* $.type(["T", "E"], (T, E) =>
      $.union({ ok: true, value: T }, { ok: false, error: E }))
    const Applied = yield* $.type($.apply(Result, [$.T.string, $.T.number]))
    void Applied
    return 0
  })
  assert.equal(emitProgram(program).includes("type Applied = Result<string, number>;"), true)
})

test("inter, arrayOf, and fnType emit", () => {
  const program = Program.build(function*() {
    const Both = yield* $.type($.inter({ a: $.T.string }, { b: $.T.number }))
    const Strings = yield* $.type($.arrayOf($.T.string))
    const Fn = yield* $.type($.fnType([$.T.string], $.T.number))
    void Both
    void Strings
    void Fn
    return 0
  })
  const emitted = emitProgram(program)
  assert.equal(emitted.includes("type Both = {\n  a: string;\n} & {\n  b: number;\n};"), true)
  assert.equal(emitted.includes("type Strings = string[];"), true)
  assert.equal(emitted.includes("type Fn = (arg0: string) => number;"), true)
})
