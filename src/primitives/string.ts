import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export interface StringLiteral extends Expr<string> {
  readonly _tag: "string-literal"
  readonly value: string
}

export interface StringType extends TypeExpr<string> {
  readonly _tag: "string-type"
}

export const stringLiteral = (value: string): StringLiteral =>
  makePipeable({ _tag: "string-literal", value })

export const Type = (): StringType => makePipeable({ _tag: "string-type" })
