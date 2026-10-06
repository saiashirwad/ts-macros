import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("parameter hints are unique within a signature", () => {
  const params = [T.param("x", T.Number), T.param("x", T.String)] as const
  assertType<Equal<T.CheckParams<[typeof params[0], typeof params[1]]>, ["duplicate parameter name", "x"]>>()
  assert.throws(() =>
    T.build(function*() {
      // @ts-expect-error duplicate parameter hints cannot be addressed independently
      return yield* T.fn("actual", {
        params: [T.param("x", T.Number), T.param("x", T.String)],
        body: function*({ x }) {
          yield* T.assign(x, 1)
          return x
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() => {
    // @ts-expect-error arrows use the same parameter-name check
    T.arrow({
      params: [T.param("x", T.Number), T.param("x", T.String)],
      body: function*({ x }) {
        return x
      },
    })
  }, /duplicate parameter name "x"/)
})

test("required, optional, and rest parameter names share one namespace", () => {
  assertType<Equal<T.CheckParams<[T.Param<"x", number>, T.Param<"x", string, "optional">]>, ["duplicate parameter name", "x"]>>()
  assertType<Equal<T.CheckParams<[T.Param<"x", number>, T.Param<"x", string, "rest">]>, ["duplicate parameter name", "x"]>>()
  assert.throws(() => T.paramBindings([T.param("x", T.Number), T.rest("x", T.String)]), /duplicate parameter name "x"/)
})

test("build-time checks catch duplicate names in non-tuple parameter lists", () => {
  const params: T.AnyParams = [T.param("x", T.Number), T.param("x", T.String)]
  assert.throws(() =>
    T.build(function*() {
      // @ts-expect-error erased parameter-name types must be rejected statically too
      return yield* T.fn("actual", {
        params,
        body: function*() {
          return "A"
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() =>
    // @ts-expect-error erased parameter-name types must be rejected statically too
    T.arrow({
      params,
      body: function*() {
        return "A"
      },
    }), /duplicate parameter name "x"/)
})
