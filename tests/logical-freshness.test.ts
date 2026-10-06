import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("unreachable logical operands do not pass freshness through a const", () => {
  assertType<Equal<T.Denotes<typeof cases.stableLogicalCopy.program.result>, false>>()
  assert.equal(cases.stableLogicalCopy.program.result.fresh, false)
  assert.deepEqual((cases.stableLogicalCopy.program.statements[2] as T.BindingDeclaration).type, T.Literal(false))
  const truthy = cases.stableTruthyLogicalCopy.program.statements[2] as T.BindingDeclaration
  assert.deepEqual(truthy.type, T.Literal("selected"))
  const selected = cases.selectedLogicalCopy.program.statements[2] as T.BindingDeclaration
  assert.equal(selected.type, T.String)
})

test("selectable logical operands preserve strict writes", () => {
  T.build(function*() {
    const left = yield* T.const("left", false, T.Literal(false))
    const selected = yield* T.const("selected", T.and(left, "unreachable"))
    const actual = yield* T.let("actual", selected)
    // @ts-expect-error an unreachable fresh string must not turn pinned false into boolean
    T.assign(actual, true)
    return actual
  })
})
