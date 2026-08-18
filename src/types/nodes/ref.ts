import { makeTypeNode } from "../../pipeable.ts"
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
  readonly callee: TypeRef<any>
  readonly args: Array<TypeExpr<any>>
}

export const Ref = <A = unknown>(name: string, ...args: TypeExpr<any>[]): TypeRef<A> =>
  makeTypeNode(args.length > 0 ? { tag: "type-ref", name, args } : { tag: "type-ref", name })

export const Nominal = <A = unknown>(
  name: string,
  erasesTo: TypeExpr<A>,
  ...args: TypeExpr<any>[]
): TypeRef<A> =>
  makeTypeNode(
    args.length > 0
      ? { tag: "type-ref", name, args, erasesTo }
      : { tag: "type-ref", name, erasesTo },
  )

export const Apply = <Callee extends TypeRef<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
): Application<ApplyType<Callee, Args>> =>
  makeTypeNode({
    tag: "application",
    callee,
    args,
  })
