import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("an explicit unknown return annotation is distinct from no annotation", () => {
  assertType<Equal<T.Denotes<typeof cases.annotatedUnknownArrow.program.result>, () => unknown>>()
  assertType<Equal<T.Denotes<typeof cases.annotatedUnknownFunction.program.result>, () => unknown>>()
  const arrowType = (cases.annotatedUnknownArrow.program.statements[0] as T.BindingDeclaration).type as T.FunctionType
  const fnType = (cases.annotatedUnknownFunction.program.statements[0] as T.BuiltFunction).type
  assert.equal(arrowType.return, T.Unknown)
  assert.equal(fnType?.return, T.Unknown)
})

const invalidAnnotatedBody = () => {
  const arrow = T.arrow({
    returns: T.Unknown,
    body: function*() {
      return () => 1
    },
  })
  assertType<Equal<typeof arrow, FailedCheck<["cannot lift", () => 1]>>>()
  // @ts-expect-error even an unknown annotation does not make an invalid body liftable
  T.const("invalid", arrow)
}
void invalidAnnotatedBody
