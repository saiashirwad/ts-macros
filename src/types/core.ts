import { makePipeable, type Pipeable } from "../pipeable.ts"

declare const TypeExprTypeId: unique symbol

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [TypeExprTypeId]?: A
}

declare const TypeVariableId: unique symbol

export type TypeVariableId = typeof TypeVariableId

export interface Variable<Name extends string = string> {
  readonly [TypeVariableId]: Name
}

export interface Param<
  Name extends string,
  Extends extends TypeExpr,
  A = Variable<Name>,
> extends TypeExpr<A> {
  readonly tag: "param"
  readonly name: Name
  readonly extends?: Extends | undefined
}

export type AnyParam = Param<string, any>
export type AnyParams = AnyParam[]

export interface Fn<Params extends AnyParams = AnyParams, Body = unknown> {
  readonly params: Params
  readonly body: Body
}

export type Declared<Params extends AnyParams, Body> = Params extends [] ? Body : Fn<Params, Body>

export type Denotes<T extends TypeExpr<any>> = T extends TypeExpr<infer A> ? A : never

export type ArgTypes<Args extends TypeExpr<any>[]> = {
  [K in keyof Args]: Denotes<Args[K]>
}

export const Param = <const Name extends string, Extends extends TypeExpr>(
  name: Name,
  _extends?: Extends,
): Param<Name, Extends> => makePipeable({ tag: "param", name, extends: _extends })
