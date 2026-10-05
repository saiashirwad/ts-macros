import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Type } from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import type { Equal } from "./typing.ts"

test("bigint logical operators retain their zero alternative", () => {
  const exact: Equal<Expr.Denotes<typeof cases.bigintLogical.program.result>, (x: bigint) => 0n | "yes"> = true
  void [exact]
  const declaration = cases.bigintLogical.program.statements[0] as Decl.BuiltFunction
  assert.deepEqual(declaration.type?.return, Type.union(Type.literal(0n), Type.literal("yes")))
  assert.deepEqual(logicalType("&&", Type.literal(0n), Type.string), Type.literal(0n))
  assert.deepEqual(logicalType("||", Type.literal(0n), Type.string), Type.string)
})

const bigintLogicalUnsound = () =>
  Program.build(function*() {
    return yield* Decl.fn("actual", {
      params: [Expr.param("x", Type.bigint)],
      body: function*({ x }) {
        // @ts-expect-error 0n has no string methods
        return Expr.call(Expr.prop(Expr.and(x, "yes"), "toUpperCase"))
      },
    })
  })
void bigintLogicalUnsound
