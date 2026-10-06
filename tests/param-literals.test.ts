import { test } from "node:test"

import * as T from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("parameter names reject unions and widened strings before uniqueness checks", () => {
  assertType<
    Equal<
      T.CheckParams<[T.Param<"a", number>, T.Param<"a" | "b", string>]>,
      ["parameter name must be a single string literal", "a" | "b"]
    >
  >()
  assertType<
    Equal<
      T.CheckParams<[T.Param<string, number>, T.Param<string, number>]>,
      ["parameter name must be a single string literal", string]
    >
  >()
  assertType<
    Equal<
      T.CheckParams<[T.Param<"a" | "b", string>, T.Param<"a", number>]>,
      ["parameter name must be a single string literal", "a" | "b"]
    >
  >()
})

const repro = () => {
  const name: "a" | "b" = Math.random() < 2 ? "b" : "a"
  T.build(function*() {
    // @ts-expect-error union names cannot be used in a signature
    return yield* T.fn("actual", {
      params: [T.param("a", T.Number), T.param(name, T.String)],
      body: function*({ a }) {
        yield* T.assign(a, "oops")
        return a
      },
    })
  })
  function make(name: string) {
    return T.param(name, T.Number)
  }
  T.build(function*() {
    // @ts-expect-error widened names receive the literal-name diagnostic, not false duplicate
    return yield* T.fn("actual", {
      params: [make("a"), make("b")],
      body: function*() {
        return 1
      },
    })
  })
  // @ts-expect-error arrows share literal-name validation
  T.arrow({
    params: [T.param(name, T.Number)],
    body: function*() {
      return 1
    },
  })
}
void repro
