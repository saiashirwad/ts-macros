import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { typeOf } from "./typing.ts"

test("bigint arithmetic has bigint denotations and attached types", () => {
  const program = T.build(function*() {
    return yield* T.fn("arithmetic", {
      params: [T.param("a", T.BigInt), T.param("b", T.BigInt)],
      body: function*({ a, b }) {
        for (const op of ["+", "-", "*", "/", "%"] as const) {
          const expression = T.binary(op, a, b)
          typeOf(expression).is<bigint>()
          assert.equal(expression.type, T.BigInt)
        }
        typeOf(T.lt(a, 1)).is<boolean>()
        typeOf(T.add("x", a)).is<string>()
        return T.add(a, b)
      },
    })
  })
  const declaration = program.statements[0] as T.BuiltFunction
  assert.equal(declaration.type?.return, T.BigInt)
})

const invalidOperands = () => {
  const bigint = T.hostValue<bigint>("bigintValue")
  const symbol = T.hostValue<symbol>("symbolValue")
  // @ts-expect-error non-comparable equality operands
  T.eq(1, "x")
  // @ts-expect-error non-comparable inequality operands
  T.neq(1, "x")
  // @ts-expect-error disjoint literals are not comparable
  T.eq(1, 2)
  // @ts-expect-error symbols cannot be concatenated
  T.add("x", symbol)
  // @ts-expect-error symbols cannot be concatenated in either position
  T.add(symbol, "x")
  // @ts-expect-error a union that may contain a symbol cannot be concatenated
  T.add("x", T.hostValue<symbol | string>("maybeSymbol"))
  // @ts-expect-error number and bigint cannot mix in arithmetic
  T.add(bigint, 1)
  // @ts-expect-error number and bigint cannot mix in arithmetic
  T.mul(1, bigint)
}
void invalidOperands
