import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { BindingId } from "../identity.ts"
import type { BindingNames } from "../scope.ts"
import type { Block, Statement } from "../statement.ts"
import type * as Type from "../types/index.ts"

/** what a target's handlers get: recursive emission plus the emitted name of any binding */
export interface Emit<E, S, T> {
  expr(node: Expr.Expr<any>): E
  statement(node: Statement): S
  block(block: Block): S[]
  type(node: Type.TypeExpr<any>): T
  bindingName(id: BindingId, nameHint: string): string
}

type WithTag<Nodes extends { readonly tag: string }, Tag extends Nodes["tag"]> = Extract<Nodes, { readonly tag: Tag }>

type Handlers<Nodes extends { readonly tag: string }, E, S, T, R> = {
  readonly [K in Nodes["tag"]]: (node: WithTag<Nodes, K>, emit: Emit<E, S, T>) => R
}

export type ExprHandlers<E, S, T> = Handlers<Expr.Any | Fn.Any, E, S, T, E>
export type StatementHandlers<E, S, T> = Handlers<Statement, E, S, T, S>
export type TypeHandlers<E, S, T> = Handlers<Type.Any, E, S, T, T>

/** an emitter: one handler per node kind, producing E for expressions, S for statements, T for types */
export interface Target<E, S, T> {
  readonly expr: ExprHandlers<E, S, T>
  readonly statement: StatementHandlers<E, S, T>
  readonly type: TypeHandlers<E, S, T>
}

export const makeEmit = <E, S, T>(target: Target<E, S, T>, names: BindingNames): Emit<E, S, T> => {
  const dispatch = <R>(handlers: { readonly [tag: string]: (node: never, emit: Emit<E, S, T>) => R }, node: unknown, domain: string): R => {
    const tag = (node as { readonly tag?: unknown } | null)?.tag
    if (typeof tag !== "string") throw new Error(`expected an IR node, got ${node === null ? "null" : typeof node}`)
    const handler = handlers[tag]
    if (handler === undefined) throw new Error(`no ${domain} handler for "${tag}"`)
    return handler(node as never, emit)
  }

  const emit: Emit<E, S, T> = {
    expr: (node) => dispatch(target.expr, node, "expression"),
    statement: (node) => dispatch(target.statement, node, "statement"),
    block: (block) => block.statements.map(emit.statement),
    type: (node) => dispatch(target.type, node, "type"),
    bindingName: (id, nameHint) => names.get(id) ?? nameHint,
  }
  return emit
}
