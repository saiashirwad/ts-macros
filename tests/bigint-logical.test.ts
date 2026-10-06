import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("bigint logical operators retain their zero alternative", () => {
  assertType<Equal<T.Denotes<typeof cases.bigintLogical.program.result>, (x: bigint) => 0n | "yes">>()
  const declaration = cases.bigintLogical.program.statements[0] as T.BuiltFunction
  assert.deepEqual(declaration.type?.return, T.Union(T.Literal(0n), T.Literal("yes")))
  assert.deepEqual(logicalType("&&", T.Literal(0n), T.String), T.Literal(0n))
  assert.deepEqual(logicalType("||", T.Literal(0n), T.String), T.String)
})

const bigintLogicalUnsound = () =>
  T.build(function*() {
    return yield* T.fn("actual", {
      params: [T.param("x", T.BigInt)],
      body: function*({ x }) {
        // @ts-expect-error 0n has no string methods
        return T.call(T.prop(T.and(x, "yes"), "toUpperCase"))
      },
    })
  })
void bigintLogicalUnsound
