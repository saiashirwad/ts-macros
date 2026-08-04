import type { Expr } from "../foundation/expr"
import type { TypeExpr } from "../foundation/type-expr"
import { makePipeable } from "../pipeable"

export interface NumberLiteral extends Expr<number> {
  readonly _tag: "number-literal"
  readonly value: number
}

export interface NumberType extends TypeExpr<number> {
  readonly _tag: "number-type"
}

export const numberLiteral = (value: number): NumberLiteral =>
  makePipeable({
    _tag: "number-literal",
    value,
  }) as NumberLiteral

export const numberType = (): NumberType =>
  makePipeable({
    _tag: "number-type",
  }) as NumberType
