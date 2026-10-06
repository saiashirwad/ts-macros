import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("an explicit unknown return annotation is distinct from no annotation", () => {
  assertType<Equal<$.Denotes<typeof cases.annotatedUnknownArrow.program.result>, () => unknown>>()
  assertType<Equal<$.Denotes<typeof cases.annotatedUnknownFunction.program.result>, () => unknown>>()
  const arrowType = (cases.annotatedUnknownArrow.program.statements[0] as $.BindingDeclaration).type as $.Function
  const fnType = (cases.annotatedUnknownFunction.program.statements[0] as $.BuiltFunction).type
  assert.equal(arrowType.return, $.Unknown)
  assert.equal(fnType?.return, $.Unknown)
})

const invalidAnnotatedBody = () => {
  const arrow = $.arrow({
    returns: $.Unknown,
    body: function*() {
      return () => 1
    },
  })
  assertType<Equal<typeof arrow, FailedCheck<["cannot lift", () => 1]>>>()
  // @ts-expect-error even an unknown annotation does not make an invalid body liftable
  $.const("invalid", arrow)
}
void invalidAnnotatedBody
