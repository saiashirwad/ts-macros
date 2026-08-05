import { makePipeable, type Pipeable } from "./pipeable.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
}

export interface VarRef<A = unknown> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
}

export interface StringLiteral extends Expr<string> {
  readonly tag: "string-literal"
  readonly value: string
}

export interface NumberLiteral extends Expr<number> {
  readonly tag: "number-literal"
  readonly value: number
}

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprShape<Fields extends ExprFields> = {
  readonly [K in keyof Fields]: Fields[K] extends Expr<infer A> ? A : never
}

export interface ObjectExpr<Fields extends ExprFields = ExprFields> extends Expr<
  ObjectExprShape<Fields>
> {
  readonly tag: "object-expr"
  readonly fields: Fields
}

export const stringLiteral = (value: string): StringLiteral =>
  makePipeable({ tag: "string-literal", value })

export const numberLiteral = (value: number): NumberLiteral =>
  makePipeable({ tag: "number-literal", value })

export const object = <const Fields extends ExprFields>(fields: Fields): ObjectExpr<Fields> =>
  makePipeable({
    tag: "object-expr",
    fields,
  }) as ObjectExpr<Fields>
