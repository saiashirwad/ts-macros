import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Type } from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("an explicit unknown return annotation is distinct from no annotation", () => {
  assertType<Equal<Expr.Denotes<typeof cases.annotatedUnknownArrow.program.result>, () => unknown>>()
  assertType<Equal<Expr.Denotes<typeof cases.annotatedUnknownFunction.program.result>, () => unknown>>()
  const arrowType = (cases.annotatedUnknownArrow.program.statements[0] as Decl.BindingDeclaration).type as Type.FunctionType
  const fnType = (cases.annotatedUnknownFunction.program.statements[0] as Decl.BuiltFunction).type
  assert.equal(arrowType.return, Type.unknown)
  assert.equal(fnType?.return, Type.unknown)
})

const invalidAnnotatedBody = () => {
  const arrow = Expr.arrow({
    returns: Type.unknown,
    body: function*() {
      return () => 1
    },
  })
  assertType<Equal<typeof arrow, FailedCheck<["cannot lift", () => 1]>>>()
  // @ts-expect-error even an unknown annotation does not make an invalid body liftable
  Decl.const("invalid", arrow)
}
void invalidAnnotatedBody
