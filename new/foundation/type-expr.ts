import type { Pipeable } from "../pipeable";

declare const typeExprTypeId: unique symbol;

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [typeExprTypeId]?: A;
}
