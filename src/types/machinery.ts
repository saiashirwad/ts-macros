import type { AnyParam, AnyParams, ArgTypes, Denotes, Fn, TypeExpr, Variable } from "./core.ts"

type ResolveVariable<
  Params extends AnyParams,
  Args extends unknown[],
  Name extends string,
> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Args extends [infer Arg, ...infer Rest extends unknown[]] ?
        Head["name"] extends Name ? Arg
      : ResolveVariable<Tail, Rest, Name>
    : never
  : never

type SubstituteTuple<
  Items extends unknown[],
  Params extends AnyParams,
  Args extends unknown[],
> = Items extends [infer Head, ...infer Tail extends unknown[]] ? [Substitute<Head, Params, Args>, ...SubstituteTuple<Tail, Params, Args>] : []

export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> =
    Body extends Variable<infer Name> ? ResolveVariable<Params, Args, Name>
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteTuple<FnArgs, Params, Args>) => Substitute<Result, Params, Args>
  : Body extends object ? { [K in keyof Body]: Substitute<Body[K], Params, Args> }
  : Body

export type Apply<Callee extends TypeExpr<any>, Args extends TypeExpr<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      Args["length"] extends Params["length"] ? Substitute<Body, Params, ArgTypes<Args>>
    : never
  : never
