import type { Declaration } from "../foundation/declaration";
import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import type { Param, ParamBindings, ParamExprs } from "../functions/params";
import { Class as PipeableClass, makePipeable } from "../pipeable";
import { makeFunctionRef } from "../refs/function-ref";
import type { FunctionRef } from "../refs/function-ref";
import type { ArgTypes, Substitute } from "../type-level/apply";
import type { TypeParam } from "../type-level/param";

export type CallableExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> = Expr<(...args: ParamExprs<Params>) => Return>;

export type InstantiateParams<
  Params extends readonly Param<string, any>[],
  TypeParams extends readonly TypeParam<string, any>[],
  TypeArgs extends readonly TypeExpr<any>[],
> =
  Params extends (
    readonly [
      infer Head extends Param<string, any>,
      ...infer Tail extends readonly Param<string, any>[],
    ]
  ) ?
    readonly [
      Head extends Param<infer Name, infer A> ?
        Param<Name, Substitute<A, TypeParams, ArgTypes<TypeArgs>>>
      : never,
      ...InstantiateParams<Tail, TypeParams, TypeArgs>,
    ]
  : readonly [];

export type InstantiateReturn<
  Return,
  TypeParams extends readonly TypeParam<string, any>[],
  TypeArgs extends readonly TypeExpr<any>[],
> = Substitute<Return, TypeParams, ArgTypes<TypeArgs>>;

export interface FunctionTypeApplicationExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly TypeParam<
    string,
    any
  >[],
  TypeArgs extends readonly TypeExpr<any>[] = readonly TypeExpr<any>[],
> extends CallableExpr<
  InstantiateParams<Params, TypeParams, TypeArgs>,
  InstantiateReturn<Return, TypeParams, TypeArgs>
> {
  readonly _tag: "function-type-application-expr";
  readonly callee: FunctionRef<Params, Return, TypeParams>;
  readonly typeArgs: TypeArgs;
}

export interface CallExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> extends Expr<Return> {
  readonly _tag: "call-expr";
  readonly callee: CallableExpr<Params, Return>;
  readonly args: ParamExprs<Params>;
}

export type FunctionImpl<
  Params extends readonly Param<string, any>[],
  Return,
> = (
  bindings: ParamBindings<Params>,
) => Generator<Declaration, Expr<Return>, unknown>;

export interface FunctionDecl<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends Declaration {
  readonly _tag: "function-decl";
  readonly name: string;
  readonly typeParams: TypeParams;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

export interface FunctionSpec<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> {
  readonly name: string;
  readonly typeParams: TypeParams;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

declare const unsetFunctionReturnId: unique symbol;

export interface UnsetFunctionReturn {
  readonly [unsetFunctionReturnId]: "unset-function-return";
}

type ImplInputBuilder<
  Params extends readonly Param<string, any>[],
  InferredReturn,
  CurrentReturn,
  TypeParams extends readonly TypeParam<string, any>[],
> =
  [CurrentReturn] extends [UnsetFunctionReturn] ?
    FunctionBuilder<Params, CurrentReturn, TypeParams>
  : [InferredReturn] extends [CurrentReturn] ?
    [CurrentReturn] extends [InferredReturn] ?
      FunctionBuilder<Params, CurrentReturn, TypeParams>
    : never
  : never;

type ResolvedFunctionReturn<CurrentReturn, InferredReturn> =
  [CurrentReturn] extends [UnsetFunctionReturn] ? InferredReturn
  : CurrentReturn;

export class FunctionBuilder<
  Params extends readonly Param<string, any>[] = readonly [],
  Return = UnsetFunctionReturn,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends PipeableClass() {
  constructor(readonly spec: FunctionSpec<Params, Return, TypeParams>) {
    super();
  }

  withSpec<
    NextParams extends readonly Param<string, any>[],
    NextReturn,
    NextTypeParams extends readonly TypeParam<string, any>[],
  >(
    spec: FunctionSpec<NextParams, NextReturn, NextTypeParams>,
  ): FunctionBuilder<NextParams, NextReturn, NextTypeParams> {
    return new FunctionBuilder(spec);
  }

  *[Symbol.iterator](): Generator<
    FunctionDecl<Params, Return, TypeParams>,
    FunctionRef<Params, Return, TypeParams>,
    unknown
  > {
    yield {
      _tag: "function-decl",
      name: this.spec.name,
      typeParams: this.spec.typeParams,
      params: this.spec.params,
      returnType: this.spec.returnType,
      impl: this.spec.impl,
    };

    return makeFunctionRef<Params, Return, TypeParams>(this.spec.name);
  }
}

export const function_ = (name: string): FunctionBuilder =>
  new FunctionBuilder({
    name,
    typeParams: [],
    params: [],
  });

export const p = <const Name extends string, A>(
  name: Name,
  annotation: TypeExpr<A>,
): Param<Name, A> => ({
  _tag: "param",
  name,
  type: annotation,
});

export const params =
  <const Params extends readonly Param<string, any>[]>(...nextParams: Params) =>
  <Return, TypeParams extends readonly TypeParam<string, any>[]>(
    builder: FunctionBuilder<any, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      params: nextParams,
    } as FunctionSpec<Params, Return, TypeParams>);

export const returns =
  <Return>(returnType: TypeExpr<Return>) =>
  <
    Params extends readonly Param<string, any>[],
    TypeParams extends readonly TypeParam<string, any>[],
  >(
    builder: FunctionBuilder<Params, any, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      returnType,
    } as FunctionSpec<Params, Return, TypeParams>);

export const impl =
  <
    Params extends readonly Param<string, any>[],
    InferredReturn,
    TypeParams extends readonly TypeParam<string, any>[],
  >(
    implementation: FunctionImpl<Params, InferredReturn>,
  ) =>
  <CurrentReturn>(
    builder: ImplInputBuilder<
      Params,
      InferredReturn,
      CurrentReturn,
      TypeParams
    >,
  ): FunctionBuilder<
    Params,
    ResolvedFunctionReturn<CurrentReturn, InferredReturn>,
    TypeParams
  > =>
    builder.withSpec<
      Params,
      ResolvedFunctionReturn<CurrentReturn, InferredReturn>,
      TypeParams
    >({
      ...builder.spec,
      impl: implementation,
    } as FunctionSpec<
      Params,
      ResolvedFunctionReturn<CurrentReturn, InferredReturn>,
      TypeParams
    >);

export const call = <Params extends readonly Param<string, any>[], Return>(
  callee: CallableExpr<Params, Return>,
  args: ParamExprs<Params>,
): CallExpr<Params, Return> =>
  makePipeable({
    _tag: "call-expr",
    callee,
    args,
  });

export const instantiate = <
  Params extends readonly Param<string, any>[],
  Return,
  TypeParams extends readonly TypeParam<string, any>[],
  const TypeArgs extends readonly TypeExpr<any>[],
>(
  callee: FunctionRef<Params, Return, TypeParams>,
  ...typeArgs: TypeArgs
): FunctionTypeApplicationExpr<Params, Return, TypeParams, TypeArgs> =>
  makePipeable({
    _tag: "function-type-application-expr",
    callee,
    typeArgs,
  });
