import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType, typeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("returned object shapes include missing optional properties", () => {
  const program = $.build(function*() {
    const choose = yield* $.fn("choose", {
      params: [$.param("b", $.Boolean)],
      body: function*({ b }) {
        yield* $.if(b, function*() {
          yield* $.return({ a: 1 })
        })
        return { b: 2 }
      },
    })
    typeOf(choose).is<(b: boolean) => { a: number; b?: never } | { a?: never; b: number }>()
    return choose
  })
  const declaration = program.statements[0] as $.BuiltFunction
  const returned = declaration.type?.return as $.Union
  assert.deepEqual((returned.members[0] as $.Object).fields.b, $.Optional($.Never))
  assert.deepEqual((returned.members[1] as $.Object).fields.a, $.Optional($.Never))
})

test("non-fresh object references do not supply normalization keys", () => {
  assertType<Equal<$.Denotes<typeof cases.mixedObjectReturns.program.result>, (b: boolean, a: { a: number }) => { a: number } | { b: number }>>()
  const declaration = cases.mixedObjectReturns.program.statements[0] as $.BuiltFunction
  const returned = declaration.type?.return as $.Union
  assert.deepEqual(Object.keys((returned.members[0] as $.Object).fields), ["a"])
  assert.deepEqual(Object.keys((returned.members[1] as $.Object).fields), ["b"])
})

test("conditional object unions normalize before being stored in bindings", () => {
  assertType<
    Equal<
      $.Denotes<typeof cases.objectConditionalBinding.program.result>,
      (b: boolean) => { a: number; b?: never } | { a?: never; b: number }
    >
  >()
  const declaration = cases.objectConditionalBinding.program.statements[0] as $.BuiltFunction
  const returned = declaration.type?.return as $.Union
  const binding = declaration.body.statements[0] as $.BindingDeclaration
  assert.deepEqual(binding.type, returned)
  assert.deepEqual((returned.members[0] as $.Object).fields.b, $.Optional($.Never))
  assert.deepEqual((returned.members[1] as $.Object).fields.a, $.Optional($.Never))
  const array = cases.objectArrayUnion.program.statements[0] as $.BindingDeclaration
  assert.deepEqual((array.type as $.Array).element, returned)
})
