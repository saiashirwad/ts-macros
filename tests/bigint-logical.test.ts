import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("bigint logical operators retain their zero alternative", () => {
  assertType<Equal<$.Denotes<typeof cases.bigintLogical.program.result>, (x: bigint) => 0n | "yes">>()
  const declaration = cases.bigintLogical.program.statements[0] as $.BuiltFunction
  assert.deepEqual(declaration.type?.return, $.Union($.Literal(0n), $.Literal("yes")))
  assert.deepEqual(logicalType("&&", $.Literal(0n), $.String), $.Literal(0n))
  assert.deepEqual(logicalType("||", $.Literal(0n), $.String), $.String)
})

const bigintLogicalUnsound = () =>
  $.build(function*() {
    return yield* $.fn("actual", {
      params: [$.param("x", $.BigInt)],
      body: function*({ x }) {
        // @ts-expect-error 0n has no string methods
        return $.call($.prop($.and(x, "yes"), "toUpperCase"))
      },
    })
  })
void bigintLogicalUnsound
