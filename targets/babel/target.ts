import * as t from "@babel/types"

import { makeEmit, type Target } from "../../src/emit/target.ts"
import type { Block } from "../../src/statement.ts"
import { babelExpressions } from "./expr.ts"
import { babelStatements, blockToBabel as emitBlock } from "./statement.ts"
import { babelTypes } from "./type.ts"

export const babel: Target<t.Expression, t.Statement, t.TSType> = {
  expr: babelExpressions,
  statement: babelStatements,
  type: babelTypes,
}

const standalone = makeEmit(babel)

export const exprToBabel = standalone.expr
export const statementToBabel = standalone.statement
export const typeExprToBabel = standalone.type
export const blockToBabel = (block: Block): t.BlockStatement => emitBlock(standalone, block)
