import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import type { VarRef } from "../refs/var-ref";

export interface Param<Name extends string = string, A = unknown> {
  readonly _tag: "param";
  readonly name: Name;
  readonly type: TypeExpr<A>;
}

export type ParamBindings<Params extends readonly Param<string, any>[]> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A> ? VarRef<A> : never;
};

export type ParamExprs<Params extends readonly Param<string, any>[]> = {
  readonly [K in keyof Params]: Params[K] extends Param<any, infer A> ? Expr<A> : never;
};
