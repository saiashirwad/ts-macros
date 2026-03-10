import type { Declaration } from "../foundation/declaration";
import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import type { Param, ParamBindings, ParamExprs } from "../functions/params";
import { Class as PipeableClass, makePipeable } from "../pipeable";
import { makeFunctionRef } from "../refs/function-ref";
import type { FunctionRef } from "../refs/function-ref";

export interface CallExpr<A = unknown> extends Expr<A> {
  readonly _tag: "call-expr";
  readonly callee: FunctionRef<any, A>;
  readonly args: ReadonlyArray<Expr<any>>;
}

export type FunctionImpl<Params extends readonly Param<string, any>[], Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Declaration, Expr<Return>, unknown>;

export interface FunctionDecl<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> extends Declaration {
  readonly _tag: "function-decl";
  readonly name: string;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

export interface FunctionSpec<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> {
  readonly name: string;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

export class FunctionBuilder<
  Params extends readonly Param<string, any>[] = readonly [],
  Return = unknown,
> extends PipeableClass() {
  constructor(readonly spec: FunctionSpec<Params, Return>) {
    super();
  }

  withSpec<NextParams extends readonly Param<string, any>[], NextReturn>(
    spec: FunctionSpec<NextParams, NextReturn>,
  ): FunctionBuilder<NextParams, NextReturn> {
    return new FunctionBuilder(spec);
  }

  *[Symbol.iterator](): Generator<
    FunctionDecl<Params, Return>,
    FunctionRef<Params, Return>,
    unknown
  > {
    yield {
      _tag: "function-decl",
      name: this.spec.name,
      params: this.spec.params,
      returnType: this.spec.returnType,
      impl: this.spec.impl,
    };

    return makeFunctionRef<Params, Return>(this.spec.name);
  }
}

export const function_ = (name: string): FunctionBuilder =>
  new FunctionBuilder({
    name,
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
  <Return>(builder: FunctionBuilder<any, Return>): FunctionBuilder<Params, Return> =>
    builder.withSpec<Params, Return>({
      ...builder.spec,
      params: nextParams,
    } as FunctionSpec<Params, Return>);

export const returns =
  <Return>(returnType: TypeExpr<Return>) =>
  <Params extends readonly Param<string, any>[]>(
    builder: FunctionBuilder<Params, any>,
  ): FunctionBuilder<Params, Return> =>
    builder.withSpec<Params, Return>({
      ...builder.spec,
      returnType,
    } as FunctionSpec<Params, Return>);

export const impl =
  <Params extends readonly Param<string, any>[], Return>(
    implementation: FunctionImpl<Params, Return>,
  ) =>
  (builder: FunctionBuilder<Params, Return>): FunctionBuilder<Params, Return> =>
    builder.withSpec<Params, Return>({
      ...builder.spec,
      impl: implementation,
    });

export const call = <Params extends readonly Param<string, any>[], Return>(
  callee: FunctionRef<Params, Return>,
  args: ParamExprs<Params>,
): CallExpr<Return> =>
  makePipeable({
    _tag: "call-expr",
    callee,
    args,
  }) as CallExpr<Return>;
