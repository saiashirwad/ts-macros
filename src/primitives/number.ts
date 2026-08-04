import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export interface NumberLiteral extends Expr<number> {
  readonly tag: "number-literal"
  readonly value: number
}

export interface NumberType extends TypeExpr<number> {
  readonly tag: "number-type"
}

export const numberLiteral = (value: number): NumberLiteral =>
  makePipeable({ tag: "number-literal", value })

export const numberType = (): NumberType => makePipeable({ tag: "number-type" })
