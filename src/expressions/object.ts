import type { Expr } from "../foundation/expr"
import { makePipeable } from "../pipeable"

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprShape<Fields extends ExprFields> = {
  readonly [K in keyof Fields]: Fields[K] extends Expr<infer A> ? A : never
}

export interface ObjectExpr<Fields extends ExprFields = ExprFields> extends Expr<
  ObjectExprShape<Fields>
> {
  readonly _tag: "object-expr"
  readonly fields: Fields
}

export const object = <const Fields extends ExprFields>(fields: Fields): ObjectExpr<Fields> =>
  makePipeable({
    _tag: "object-expr",
    fields,
  }) as ObjectExpr<Fields>
