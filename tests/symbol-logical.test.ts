import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Type } from "../src/index.ts"
import { logicalType } from "../src/types/algebra.ts"
import { cases } from "./exactness.ts"
import type { Equal } from "./typing.ts"

test("symbol truthiness agrees in denotations and runtime types", () => {
  const and: Equal<Expr.Denotes<typeof cases.symbolLogical.program.result>, (x: symbol) => string> = true
  const or: Equal<Expr.Denotes<typeof cases.symbolLogicalOr.program.result>, (x: symbol) => symbol> = true
  void [and, or]
  const andDeclaration = cases.symbolLogical.program.statements[0] as Decl.BuiltFunction
  const orDeclaration = cases.symbolLogicalOr.program.statements[0] as Decl.BuiltFunction
  assert.equal(andDeclaration.type?.return, Type.string)
  assert.equal(orDeclaration.type?.return, Type.symbol)
  assert.equal(logicalType("&&", Type.symbol, Type.string), Type.string)
  assert.equal(logicalType("||", Type.symbol, Type.string), Type.symbol)
})
