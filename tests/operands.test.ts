import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Type } from "../src/index.ts"
import { typeOf } from "./typing.ts"

test("bigint arithmetic has bigint denotations and attached types", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("arithmetic", {
      params: [Expr.param("a", Type.bigint), Expr.param("b", Type.bigint)],
      body: function*({ a, b }) {
        for (const op of ["+", "-", "*", "/", "%"] as const) {
          const expression = Expr.binary(op, a, b)
          typeOf(expression).is<bigint>()
          assert.equal(expression.type, Type.bigint)
        }
        typeOf(Expr.lt(a, 1)).is<boolean>()
        typeOf(Expr.add("x", a)).is<string>()
        return Expr.add(a, b)
      },
    })
  })
  const declaration = program.statements[0] as Decl.BuiltFunction
  assert.equal(declaration.type?.return, Type.bigint)
})

const invalidOperands = () => {
  const bigint = FFI.Value<bigint>("bigintValue")
  const symbol = FFI.Value<symbol>("symbolValue")
  // @ts-expect-error non-comparable equality operands
  Expr.eq(1, "x")
  // @ts-expect-error non-comparable inequality operands
  Expr.neq(1, "x")
  // @ts-expect-error disjoint literals are not comparable
  Expr.eq(1, 2)
  // @ts-expect-error symbols cannot be concatenated
  Expr.add("x", symbol)
  // @ts-expect-error symbols cannot be concatenated in either position
  Expr.add(symbol, "x")
  // @ts-expect-error a union that may contain a symbol cannot be concatenated
  Expr.add("x", FFI.Value<symbol | string>("maybeSymbol"))
  // @ts-expect-error number and bigint cannot mix in arithmetic
  Expr.add(bigint, 1)
  // @ts-expect-error number and bigint cannot mix in arithmetic
  Expr.mul(1, bigint)
}
void invalidOperands
