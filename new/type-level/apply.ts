import type { TypeExpr } from "../foundation/type-expr";
import { makePipeable } from "../pipeable";
import type { TypeLambda, TypeParam, TypeVariable } from "./param";

type TypeOf<TypeValue extends TypeExpr<any>> =
  TypeValue extends TypeExpr<infer A> ? A : never;

export type ArgTypes<Args extends readonly TypeExpr<any>[]> = {
  readonly [K in keyof Args]: Args[K] extends TypeExpr<infer A> ? A : never;
};

type ResolveArg<
  Params extends readonly TypeParam<string, any>[],
  Args extends readonly unknown[],
  Name extends string,
> =
  Params extends (
    readonly [
      infer Head extends TypeParam<string, any>,
      ...infer Tail extends readonly TypeParam<string, any>[],
    ]
  ) ?
    Args extends (
      readonly [infer Arg, ...infer Rest extends readonly unknown[]]
    ) ?
      Head["name"] extends Name ?
        Arg
      : ResolveArg<Tail, Rest, Name>
    : never
  : never;

type SubstituteTuple<
  Items extends readonly unknown[],
  Params extends readonly TypeParam<string, any>[],
  Args extends readonly unknown[],
> =
  Items extends (
    readonly [infer Head, ...infer Tail extends readonly unknown[]]
  ) ?
    readonly [
      Substitute<Head, Params, Args>,
      ...SubstituteTuple<Tail, Params, Args>,
    ]
  : readonly [];

export type Substitute<
  Body,
  Params extends readonly TypeParam<string, any>[],
  Args extends readonly unknown[],
> =
  Body extends TypeVariable<infer Name> ? ResolveArg<Params, Args, Name>
  : Body extends (...args: infer Parameters) => infer Result ?
    (
      ...args: SubstituteTuple<Parameters, Params, Args>
    ) => Substitute<Result, Params, Args>
  : Body extends readonly [unknown, ...unknown[]] ?
    SubstituteTuple<Body, Params, Args>
  : Body extends ReadonlyArray<infer Item> ?
    ReadonlyArray<Substitute<Item, Params, Args>>
  : Body extends object ?
    {
      readonly [K in keyof Body]: Substitute<Body[K], Params, Args>;
    }
  : Body;

export type ApplyType<
  Callee extends TypeExpr<any>,
  Args extends readonly TypeExpr<any>[],
> =
  TypeOf<Callee> extends TypeLambda<infer Params, infer Body> ?
    Args["length"] extends Params["length"] ?
      Substitute<Body, Params, ArgTypes<Args>>
    : never
  : never;

export interface TypeApplication<A = unknown> extends TypeExpr<A> {
  readonly _tag: "type-application";
  readonly callee: TypeExpr<any>;
  readonly args: ReadonlyArray<TypeExpr<any>>;
}

export const apply = <
  Callee extends TypeExpr<any>,
  const Args extends readonly TypeExpr<any>[],
>(
  callee: Callee,
  ...args: Args
): TypeApplication<ApplyType<Callee, Args>> =>
  makePipeable({
    _tag: "type-application",
    callee,
    args,
  }) as TypeApplication<ApplyType<Callee, Args>>;
