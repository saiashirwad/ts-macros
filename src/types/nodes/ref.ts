import { makePipeable } from "../../pipeable.ts"
import type { TypeExpr } from "../core.ts"
import type { Apply as ApplyType } from "../machinery.ts"

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
  readonly args?: TypeExpr<any>[] | undefined
  readonly erasesTo?: TypeExpr<any> | undefined
}

export interface Application<A = unknown> extends TypeExpr<A> {
  readonly tag: "application"
  readonly callee: TypeExpr<any>
  readonly args: Array<TypeExpr<any>>
}

export const Ref = <A = unknown>(name: string, ...args: TypeExpr<any>[]): TypeRef<A> => makePipeable({ tag: "type-ref", name, args })

export const Nominal = <A = unknown>(
  name: string,
  erasesTo: TypeExpr<A>,
  ...args: TypeExpr<any>[]
): TypeRef<A> => makePipeable({ tag: "type-ref", name, args, erasesTo })

export const Apply = <Callee extends TypeExpr<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
): Application<ApplyType<Callee, Args>> => makePipeable({ tag: "application", callee, args })
