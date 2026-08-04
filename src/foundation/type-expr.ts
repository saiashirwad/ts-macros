import type { Pipeable } from "../pipeable"

declare const TypeExprTypeId: unique symbol

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [TypeExprTypeId]?: A
}
