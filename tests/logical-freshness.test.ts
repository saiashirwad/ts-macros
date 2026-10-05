import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { cases } from "./exactness.ts"
import type { Equal } from "./typing.ts"

test("unreachable logical operands do not pass freshness through a const", () => {
  const exact: Equal<Expr.Denotes<typeof cases.stableLogicalCopy.program.result>, false> = true
  assert.equal(exact, true)
  assert.equal(cases.stableLogicalCopy.program.result.fresh, false)
  assert.deepEqual((cases.stableLogicalCopy.program.statements[2] as Decl.BindingDeclaration).type, Type.literal(false))
  const truthy = cases.stableTruthyLogicalCopy.program.statements[2] as Decl.BindingDeclaration
  assert.deepEqual(truthy.type, Type.literal("selected"))
  const selected = cases.selectedLogicalCopy.program.statements[2] as Decl.BindingDeclaration
  assert.equal(selected.type, Type.string)
})

test("selectable logical operands preserve strict writes", () => {
  Program.build(function*() {
    const left = yield* Decl.const("left", false, Type.literal(false))
    const selected = yield* Decl.const("selected", Expr.and(left, "unreachable"))
    const actual = yield* Decl.let("actual", selected)
    // @ts-expect-error an unreachable fresh string must not turn pinned false into boolean
    Stmt.assign(actual, true)
    return actual
  })
})
