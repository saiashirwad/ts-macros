import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import type { Equal } from "./typing.ts"

test("parameter hints are unique within a signature", () => {
  const params = [Expr.param("x", Type.number), Expr.param("x", Type.string)] as const
  const check: Equal<Expr.CheckParams<[typeof params[0], typeof params[1]]>, ["duplicate parameter name", "x"]> = true
  assert.equal(check, true)
  assert.throws(() =>
    // @ts-expect-error a failed signature also makes the enclosing program unbuildable
    Program.build(function*() {
      // @ts-expect-error duplicate parameter hints cannot be addressed independently
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.number), Expr.param("x", Type.string)],
        body: function*({ x }) {
          yield* Stmt.assign(x, 1)
          return x
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() => {
    // @ts-expect-error arrows use the same parameter-name check
    Expr.arrow({
      params: [Expr.param("x", Type.number), Expr.param("x", Type.string)],
      body: function*({ x }) {
        return x
      },
    })
  }, /duplicate parameter name "x"/)
})

test("required, optional, and rest parameter names share one namespace", () => {
  const optional: Equal<Expr.CheckParams<[Expr.Param<"x", number>, Expr.Param<"x", string, "optional">]>, ["duplicate parameter name", "x"]> = true
  const rest: Equal<Expr.CheckParams<[Expr.Param<"x", number>, Expr.Param<"x", string, "rest">]>, ["duplicate parameter name", "x"]> = true
  assert.equal(optional && rest, true)
  assert.throws(() => Expr.paramBindings([Expr.param("x", Type.number), Expr.rest("x", Type.string)]), /duplicate parameter name "x"/)
})

test("build-time checks catch duplicate names in non-tuple parameter lists", () => {
  const params: Expr.AnyParams = [Expr.param("x", Type.number), Expr.param("x", Type.string)]
  assert.throws(() =>
    Program.build(function*() {
      return yield* Decl.fn("actual", {
        params,
        body: function*() {
          return "A"
        },
      })
    }), /duplicate parameter name "x"/)
  assert.throws(() =>
    Expr.arrow({
      params,
      body: function*() {
        return "A"
      },
    }), /duplicate parameter name "x"/)
})
