import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("unreachable logical operands do not pass freshness through a const", () => {
  assertType<Equal<$.Denotes<typeof cases.stableLogicalCopy.program.result>, false>>()
  assert.equal(cases.stableLogicalCopy.program.result.fresh, false)
  assert.deepEqual((cases.stableLogicalCopy.program.statements[2] as $.BindingDeclaration).type, $.Literal(false))
  const truthy = cases.stableTruthyLogicalCopy.program.statements[2] as $.BindingDeclaration
  assert.deepEqual(truthy.type, $.Literal("selected"))
  const selected = cases.selectedLogicalCopy.program.statements[2] as $.BindingDeclaration
  assert.equal(selected.type, $.String)
})

test("selectable logical operands preserve strict writes", () => {
  $.build(function*() {
    const left = yield* $.const("left", false, $.Literal(false))
    const selected = yield* $.const("selected", $.and(left, "unreachable"))
    const actual = yield* $.let("actual", selected)
    // @ts-expect-error an unreachable fresh string must not turn pinned false into boolean
    $.assign(actual, true)
    return actual
  })
})
