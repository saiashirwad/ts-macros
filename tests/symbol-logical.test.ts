import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("symbol truthiness agrees in denotations and runtime types", () => {
  assertType<Equal<T.Denotes<typeof cases.symbolLogical.program.result>, (x: symbol) => string>>()
  assertType<Equal<T.Denotes<typeof cases.symbolLogicalOr.program.result>, (x: symbol) => symbol>>()
  const andDeclaration = cases.symbolLogical.program.statements[0] as T.BuiltFunction
  const orDeclaration = cases.symbolLogicalOr.program.statements[0] as T.BuiltFunction
  assert.equal(andDeclaration.type?.return, T.String)
  assert.equal(orDeclaration.type?.return, T.Symbol)
  assert.equal(logicalType("&&", T.Symbol, T.String), T.String)
  assert.equal(logicalType("||", T.Symbol, T.String), T.Symbol)
})
