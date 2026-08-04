import type { Pipeable } from "../pipeable.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
}
