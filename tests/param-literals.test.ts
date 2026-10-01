import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import type { Equal } from "./typing.ts"

test("parameter names reject unions and widened strings before uniqueness checks", () => {
  const union: Equal<
    Expr.CheckParams<[Expr.Param<"a", number>, Expr.Param<"a" | "b", string>]>,
    ["parameter name must be a single string literal", "a" | "b"]
  > = true
  const broad: Equal<
    Expr.CheckParams<[Expr.Param<string, number>, Expr.Param<string, number>]>,
    ["parameter name must be a single string literal", string]
  > = true
  const reversed: Equal<
    Expr.CheckParams<[Expr.Param<"a" | "b", string>, Expr.Param<"a", number>]>,
    ["parameter name must be a single string literal", "a" | "b"]
  > = true
  assert.equal(union && broad && reversed, true)
})

const repro = () => {
  const name: "a" | "b" = Math.random() < 2 ? "b" : "a"
  Program.build(function*() {
    // @ts-expect-error union names cannot be used in a signature
    return yield* Decl.fn("actual", {
      params: [Expr.param("a", Type.number), Expr.param(name, Type.string)],
      body: function*({ a }) {
        yield* Stmt.assign(a, "oops")
        return a
      },
    })
  })
  function make(name: string) {
    return Expr.param(name, Type.number)
  }
  Program.build(function*() {
    // @ts-expect-error widened names receive the literal-name diagnostic, not false duplicate
    return yield* Decl.fn("actual", {
      params: [make("a"), make("b")],
      body: function*() {
        return 1
      },
    })
  })
  // @ts-expect-error arrows share literal-name validation
  Expr.arrow({
    params: [Expr.param(name, Type.number)],
    body: function*() {
      return 1
    },
  })
}
void repro
