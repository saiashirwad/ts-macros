import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { typeOf } from "./typing.ts"

test("bigint arithmetic has bigint denotations and attached types", () => {
  const program = $.build(function*() {
    return yield* $.fn("arithmetic", {
      params: [$.param("a", $.BigInt), $.param("b", $.BigInt)],
      body: function*({ a, b }) {
        for (const op of ["+", "-", "*", "/", "%"] as const) {
          const expression = $.binary(op, a, b)
          typeOf(expression).is<bigint>()
          assert.equal(expression.type, $.BigInt)
        }
        typeOf($.lt(a, 1)).is<boolean>()
        typeOf($.add("x", a)).is<string>()
        return $.add(a, b)
      },
    })
  })
  const declaration = program.statements[0] as $.BuiltFunction
  assert.equal(declaration.type?.return, $.BigInt)
})

const invalidOperands = () => {
  const bigint = $.hostValue<bigint>("bigintValue")
  const symbol = $.hostValue<symbol>("symbolValue")
  // @ts-expect-error non-comparable equality operands
  $.eq(1, "x")
  // @ts-expect-error non-comparable inequality operands
  $.neq(1, "x")
  // @ts-expect-error disjoint literals are not comparable
  $.eq(1, 2)
  // @ts-expect-error symbols cannot be concatenated
  $.add("x", symbol)
  // @ts-expect-error symbols cannot be concatenated in either position
  $.add(symbol, "x")
  // @ts-expect-error a union that may contain a symbol cannot be concatenated
  $.add("x", $.hostValue<symbol | string>("maybeSymbol"))
  // @ts-expect-error number and bigint cannot mix in arithmetic
  $.add(bigint, 1)
  // @ts-expect-error number and bigint cannot mix in arithmetic
  $.mul(1, bigint)
}
void invalidOperands
