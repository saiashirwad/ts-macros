import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import type { VarRef } from "../refs/var-ref.ts"

export interface Param<Name extends string = string, A = unknown> {
  readonly tag: "param"
  readonly name: Name
  readonly type: TypeExpr<A>
}

export type AnyParams = readonly Param<string, any>[]

export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A> ? VarRef<A> : never
}

export type ParamExprs<Params extends AnyParams> = {
  readonly [K in keyof Params]: Params[K] extends Param<any, infer A> ? Expr<A> : never
}
