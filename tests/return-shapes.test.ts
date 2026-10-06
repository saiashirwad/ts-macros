import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType, typeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("returned object shapes include missing optional properties", () => {
  const program = T.build(function*() {
    const choose = yield* T.fn("choose", {
      params: [T.param("b", T.Boolean)],
      body: function*({ b }) {
        yield* T.if(b, function*() {
          yield* T.return({ a: 1 })
        })
        return { b: 2 }
      },
    })
    typeOf(choose).is<(b: boolean) => { a: number; b?: never } | { a?: never; b: number }>()
    return choose
  })
  const declaration = program.statements[0] as T.BuiltFunction
  const returned = declaration.type?.return as T.Union
  assert.deepEqual((returned.members[0] as T.Object).fields.b, T.Optional(T.Never))
  assert.deepEqual((returned.members[1] as T.Object).fields.a, T.Optional(T.Never))
})

test("non-fresh object references do not supply normalization keys", () => {
  assertType<Equal<T.Denotes<typeof cases.mixedObjectReturns.program.result>, (b: boolean, a: { a: number }) => { a: number } | { b: number }>>()
  const declaration = cases.mixedObjectReturns.program.statements[0] as T.BuiltFunction
  const returned = declaration.type?.return as T.Union
  assert.deepEqual(Object.keys((returned.members[0] as T.Object).fields), ["a"])
  assert.deepEqual(Object.keys((returned.members[1] as T.Object).fields), ["b"])
})

test("conditional object unions normalize before being stored in bindings", () => {
  assertType<
    Equal<
      T.Denotes<typeof cases.objectConditionalBinding.program.result>,
      (b: boolean) => { a: number; b?: never } | { a?: never; b: number }
    >
  >()
  const declaration = cases.objectConditionalBinding.program.statements[0] as T.BuiltFunction
  const returned = declaration.type?.return as T.Union
  const binding = declaration.body.statements[0] as T.BindingDeclaration
  assert.deepEqual(binding.type, returned)
  assert.deepEqual((returned.members[0] as T.Object).fields.b, T.Optional(T.Never))
  assert.deepEqual((returned.members[1] as T.Object).fields.a, T.Optional(T.Never))
  const array = cases.objectArrayUnion.program.statements[0] as T.BindingDeclaration
  assert.deepEqual((array.type as T.ArrayType).element, returned)
})
