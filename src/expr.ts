import { makePipeable, type Pipeable } from "./pipeable.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
}

export interface VarRef<A = unknown> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
}

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue> extends Expr<Value> {
  readonly tag: "literal"
  readonly value: Value
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
  readonly tag: "object"
  readonly fields: Fields
}

export const String = <const Value extends string>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Number = <const Value extends number>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Boolean = <const Value extends boolean>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Object = <const Fields extends ExprFields>(fields: Fields): ObjectExpr<Fields> =>
  makePipeable({ tag: "object", fields })
