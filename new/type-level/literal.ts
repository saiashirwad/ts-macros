import type { TypeExpr } from "../foundation/type-expr";
import { makePipeable } from "../pipeable";

export type LiteralValue = string | number | boolean;

export interface LiteralType<
  Value extends LiteralValue = LiteralValue,
> extends TypeExpr<Value> {
  readonly _tag: "literal-type";
  readonly value: Value;
}

export const literal = <const Value extends LiteralValue>(
  value: Value,
): LiteralType<Value> =>
  makePipeable({
    _tag: "literal-type",
    value,
  }) as LiteralType<Value>;
