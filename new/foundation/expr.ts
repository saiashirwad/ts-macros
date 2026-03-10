import type { Pipeable } from "../pipeable";

declare const exprTypeId: unique symbol;

export interface Expr<A = unknown> extends Pipeable {
  readonly [exprTypeId]?: A;
}
