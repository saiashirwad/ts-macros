import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import { makePipeable } from "../pipeable";

export interface StringLiteral extends Expr<string> {
  readonly _tag: "string-literal";
  readonly value: string;
}

export interface StringType extends TypeExpr<string> {
  readonly _tag: "string-type";
}

export const stringLiteral = (value: string): StringLiteral =>
  makePipeable({
    _tag: "string-literal",
    value,
  }) as StringLiteral;

export const stringType = (): StringType =>
  makePipeable({
    _tag: "string-type",
  }) as StringType;
