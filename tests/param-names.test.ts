import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("parameter hints are unique within a signature", () => {
  const params = [$.param("x", $.Number), $.param("x", $.String)] as const
  assertType<Equal<$.CheckParams<[typeof params[0], typeof params[1]]>, ["duplicate parameter name", "x"]>>()
  assert.throws(() =>
    $.build(function*() {
      // @ts-expect-error duplicate parameter hints cannot be addressed independently
      return yield* $.fn("actual", {
        params: [$.param("x", $.Number), $.param("x", $.String)],
        body: function*({ x }) {
          yield* $.assign(x, 1)
          return x
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() => {
    // @ts-expect-error arrows use the same parameter-name check
    $.arrow({
      params: [$.param("x", $.Number), $.param("x", $.String)],
      body: function*({ x }) {
        return x
      },
    })
  }, /duplicate parameter name "x"/)
})

test("required, optional, and rest parameter names share one namespace", () => {
  assertType<Equal<$.CheckParams<[$.Param<"x", number>, $.Param<"x", string, "optional">]>, ["duplicate parameter name", "x"]>>()
  assertType<Equal<$.CheckParams<[$.Param<"x", number>, $.Param<"x", string, "rest">]>, ["duplicate parameter name", "x"]>>()
  assert.throws(() => $.paramBindings([$.param("x", $.Number), $.rest("x", $.String)]), /duplicate parameter name "x"/)
})

test("build-time checks catch duplicate names in non-tuple parameter lists", () => {
  const params: $.AnyParams = [$.param("x", $.Number), $.param("x", $.String)]
  assert.throws(() =>
    $.build(function*() {
      // @ts-expect-error erased parameter-name types must be rejected statically too
      return yield* $.fn("actual", {
        params,
        body: function*() {
          return "A"
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() =>
    // @ts-expect-error erased parameter-name types must be rejected statically too
    $.arrow({
      params,
      body: function*() {
        return "A"
      },
    }), /duplicate parameter name "x"/)
})
