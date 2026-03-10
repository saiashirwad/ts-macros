import type { Declaration } from "../foundation/declaration";
import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import type { Param, ParamBindings, ParamExprs } from "../functions/params";
import { Class as PipeableClass, makePipeable } from "../pipeable";
import { makeFunctionRef } from "../refs/function-ref";
import type { FunctionRef } from "../refs/function-ref";
import type { TypeParam } from "../type-level/param";

export interface CallExpr<A = unknown> extends Expr<A> {
  readonly _tag: "call-expr";
  readonly callee: FunctionRef<any, A, readonly []>;
  readonly args: ReadonlyArray<Expr<any>>;
}

export type FunctionImpl<Params extends readonly Param<string, any>[], Return> = (
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

export class FunctionBuilder<
  Params extends readonly Param<string, any>[] = readonly [],
  Return = unknown,
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
    Return,
    TypeParams extends readonly TypeParam<string, any>[],
  >(
    implementation: FunctionImpl<Params, Return>,
  ) =>
  (
    builder: FunctionBuilder<Params, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      impl: implementation,
    });

export const call = <Params extends readonly Param<string, any>[], Return>(
  callee: FunctionRef<Params, Return, readonly []>,
  args: ParamExprs<Params>,
): CallExpr<Return> =>
  makePipeable({
    _tag: "call-expr",
    callee,
    args,
  }) as CallExpr<Return>;
