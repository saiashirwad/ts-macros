import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

declare const TypeVariableId: unique symbol

export interface TypeVariable<Name extends string = string> {
  readonly [TypeVariableId]: Name
}

export interface TypeParam<
  Name extends string = string,
  A = TypeVariable<Name>,
> extends TypeExpr<A> {
  readonly _tag: "type-param"
  readonly name: Name
}

export interface TypeLambda<
  Params extends readonly TypeParam<string, any>[] = readonly TypeParam<string, any>[],
  Body = unknown,
> {
  readonly params: Params
  readonly body: Body
}

export type DeclaredType<
  Params extends readonly TypeParam<string, any>[],
  Body,
> = Params extends readonly [] ? Body : TypeLambda<Params, Body>

export const param = <const Name extends string>(name: Name): TypeParam<Name> =>
  makePipeable({
    _tag: "type-param",
    name,
  })
