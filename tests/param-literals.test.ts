import { test } from "node:test"

import * as $ from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("parameter names reject unions and widened strings before uniqueness checks", () => {
  assertType<
    Equal<
      $.CheckParams<[$.Param<"a", number>, $.Param<"a" | "b", string>]>,
      ["parameter name must be a single string literal", "a" | "b"]
    >
  >()
  assertType<
    Equal<
      $.CheckParams<[$.Param<string, number>, $.Param<string, number>]>,
      ["parameter name must be a single string literal", string]
    >
  >()
  assertType<
    Equal<
      $.CheckParams<[$.Param<"a" | "b", string>, $.Param<"a", number>]>,
      ["parameter name must be a single string literal", "a" | "b"]
    >
  >()
})

const repro = () => {
  const name: "a" | "b" = Math.random() < 2 ? "b" : "a"
  $.build(function*() {
    // @ts-expect-error union names cannot be used in a signature
    return yield* $.fn("actual", {
      params: [$.param("a", $.Number), $.param(name, $.String)],
      body: function*({ a }) {
        yield* $.assign(a, "oops")
        return a
      },
    })
  })
  function make(name: string) {
    return $.param(name, $.Number)
  }
  $.build(function*() {
    // @ts-expect-error widened names receive the literal-name diagnostic, not false duplicate
    return yield* $.fn("actual", {
      params: [make("a"), make("b")],
      body: function*() {
        return 1
      },
    })
  })
  // @ts-expect-error arrows share literal-name validation
  $.arrow({
    params: [$.param(name, $.Number)],
    body: function*() {
      return 1
    },
  })
}
void repro
