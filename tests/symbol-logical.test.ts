import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("symbol truthiness agrees in denotations and runtime types", () => {
  assertType<Equal<$.Denotes<typeof cases.symbolLogical.program.result>, (x: symbol) => string>>()
  assertType<Equal<$.Denotes<typeof cases.symbolLogicalOr.program.result>, (x: symbol) => symbol>>()
  const andDeclaration = cases.symbolLogical.program.statements[0] as $.BuiltFunction
  const orDeclaration = cases.symbolLogicalOr.program.statements[0] as $.BuiltFunction
  assert.equal(andDeclaration.type?.return, $.String)
  assert.equal(orDeclaration.type?.return, $.Symbol)
  assert.equal(logicalType("&&", $.Symbol, $.String), $.String)
  assert.equal(logicalType("||", $.Symbol, $.String), $.Symbol)
})
