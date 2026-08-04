import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export interface NumberLiteral extends Expr<number> {
  readonly _tag: "number-literal"
  readonly value: number
}

export interface NumberType extends TypeExpr<number> {
  readonly _tag: "number-type"
}

export const numberLiteral = (value: number): NumberLiteral =>
  makePipeable({ _tag: "number-literal", value })

export const numberType = (): NumberType => makePipeable({ _tag: "number-type" })
