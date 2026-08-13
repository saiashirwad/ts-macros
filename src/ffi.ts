import * as Expr from "./expr.ts"
import type * as F from "./function.ts"
import { makePipeable } from "./pipeable.ts"
import type * as Type from "./types/index.ts"

const rootName = (name: string): string => {
  if (name.includes(".")) throw new Error(`ffi names are root identifiers, got "${name}"`)
  return name
}

const defaultLocal = (source: string): string => source.split("/").pop()!.replace(/^node:/, "").replace(/[^a-zA-Z0-9_$]/g, "")

export const Import = <A = unknown>(source: string, local?: string): Expr.VarRef<A> =>
  makePipeable({ tag: "var-ref", name: local ?? defaultLocal(source), source })

export const Value = <A = unknown>(name: string): Expr.VarRef<A> => makePipeable({ tag: "var-ref", name: rootName(name) })

export const Fn = <Params extends F.AnyParams = F.AnyParams, Return = unknown>(
  name: string,
): F.FunctionRef<Params, Return> => makePipeable({ tag: "function-ref", name: rootName(name) })

export const GenericFn = <
  Params extends F.AnyParams = F.AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
>(name: string): F.GenericFunctionRef<Params, Return, TypeParams> => makePipeable({ tag: "generic-function-ref", name: rootName(name) })

export const GenericProp = <
  Params extends F.AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
>() =>
<O extends Expr.Expr<any>, const K extends string & keyof Expr.Denotes<O>>(
  object: O,
  key: K,
): Expr.Expr<F.GenericSignature<Params, Return, TypeParams>> =>
  Expr.Prop(object, key) as unknown as Expr.Expr<F.GenericSignature<Params, Return, TypeParams>>
