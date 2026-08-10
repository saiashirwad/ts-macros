import type { AnyParam, AnyParams, ArgTypes, Denotes, Fn, Generic, Generics, Param, TypeExpr, Variable } from "./core.ts"

type ResolveVariable<
  Params extends AnyParams,
  Args extends unknown[],
  Name extends string,
> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Args extends [infer Arg, ...infer Rest extends unknown[]] ?
        Head["name"] extends Name ? Arg
      : ResolveVariable<Tail, Rest, Name>
    : Variable<Name>
  : Variable<Name>

type SubstituteEach<
  Items extends unknown[],
  Params extends AnyParams,
  Args extends unknown[],
> = Items extends [infer Head, ...infer Tail extends unknown[]] ? [Substitute<Head, Params, Args>, ...SubstituteEach<Tail, Params, Args>] : []

export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> =
    Body extends Variable<infer Name> ? ResolveVariable<Params, Args, Name>
  : Body extends Generic<infer GName, infer GArgs extends unknown[]> ? Generics<SubstituteEach<GArgs, Params, Args>>[GName]
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteEach<FnArgs, Params, Args>) => Substitute<Result, Params, Args>
  : Body extends object ? { [K in keyof Body]: Substitute<Body[K], Params, Args> }
  : Body

type ArityError<Expected, Got> = ["expected", Expected, "type args, got", Got]

export type Apply<Callee extends TypeExpr<any>, TypeArgs extends TypeExpr<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      TypeArgs["length"] extends Params["length"] ? Substitute<Body, Params, ArgTypes<TypeArgs>>
    : ArityError<Params["length"], TypeArgs["length"]>
  : Denotes<Callee>
