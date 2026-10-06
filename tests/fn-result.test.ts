import { test } from "node:test"

import type { FnResult } from "../src/declaration.ts"
import type { CheckParams } from "../src/expr.ts"
import * as $ from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("function result diagnostics preserve the first failing check", () => {
  const params = [$.param("x", $.Number), $.param("x", $.String)] satisfies [$.AnyParam, $.AnyParam]
  const typeParams = [$.TypeParam("T"), $.TypeParam("T")] satisfies [$.AnyTypeParam, $.AnyTypeParam]
  const early = function*() {
    yield* $.return("early")
    return 1
  }
  type Yields = ReturnType<typeof early> extends Generator<infer Y, unknown, unknown> ? Y : never

  assertType<
    Equal<
      FnResult<typeof params, typeof $.Number, typeof typeParams, Yields, () => number>,
      FailedCheck<["cannot lift", () => number]>
    >
  >()
  assertType<
    Equal<
      FnResult<typeof params, typeof $.Number, typeof typeParams, Yields, "final">,
      FailedCheck<CheckParams<typeof params>>
    >
  >()
  assertType<
    Equal<
      FnResult<[], typeof $.Number, typeof typeParams, Yields, "final">,
      FailedCheck<$.CheckTypeParamNames<typeof typeParams>>
    >
  >()
  assertType<
    Equal<
      FnResult<[], typeof $.Number, [], Yields, "final">,
      FailedCheck<["early returns", "early", "do not satisfy the declared return type", number]>
    >
  >()
  assertType<
    Equal<
      FnResult<[], typeof $.Number, [], never, "final">,
      FailedCheck<["the returned value", "final", "is not assignable to", number]>
    >
  >()
  assertType<Equal<FnResult<[], undefined, [], never, 1, "custom result">, "custom result">>()
})

test("function result checks do not distribute mixed parameter-check unions", () => {
  type Params = [] | [$.Param<"x", number>, $.Param<"x", number>]
  assertType<Equal<FnResult<Params, undefined, [], never, 1>, FailedCheck<[] | ["duplicate parameter name", "x"]>>>()
})

test("function results preserve exceptional final types and custom success types", () => {
  assertType<Equal<FnResult<[], undefined, [], never, any, "ok">, "ok">>()
  assertType<Equal<FnResult<[], undefined, [], never, never, "ok">, "ok">>()
  assertType<Equal<FnResult<[], undefined, [], never, unknown>, FailedCheck<["cannot lift", unknown]>>>()
  assertType<Equal<FnResult<[], undefined, [], never, 1, { readonly result: "ok" }>, { readonly result: "ok" }>>()
  assertType<Equal<FnResult<[], undefined, [], never, 1, string | number>, string | number>>()
  assertType<Equal<FnResult<[], undefined, [], never, 1, undefined>, undefined>>()
  assertType<Equal<FnResult<[], undefined, [], never, 1, any>, any>>()
  assertType<Equal<FnResult<[], undefined, [], never, 1, never>, never>>()
})
