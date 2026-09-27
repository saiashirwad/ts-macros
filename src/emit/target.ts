import type { Block } from "../block.ts"
import type * as Expr from "../expr.ts"
import type { BindingId } from "../identity.ts"
import type { BindingNames } from "../scope.ts"
import type { Statement } from "../statement.ts"
import type * as Type from "../types/index.ts"

/** what a target's handlers get: recursive emission plus the emitted name of any binding */
export interface Emit<E, S, T> {
  expr(node: Expr.Expr<any>): E
  statement(node: Statement): S
  block(block: Block): S[]
  type(node: Type.Type<any>): T
  bindingName(id: BindingId, name: string): string
}

type WithKind<Nodes extends { readonly kind: string }, Kind extends Nodes["kind"]> = Extract<Nodes, { readonly kind: Kind }>

type Handlers<Nodes extends { readonly kind: string }, E, S, T, R> = {
  readonly [K in Nodes["kind"]]: (node: WithKind<Nodes, K>, emit: Emit<E, S, T>) => R
}

export type ExprHandlers<E, S, T> = Handlers<Expr.Any, E, S, T, E>
export type StatementHandlers<E, S, T> = Handlers<Statement, E, S, T, S>
export type TypeHandlers<E, S, T> = Handlers<Type.Any, E, S, T, T>

/** an emitter: one handler per node kind, producing E for expressions, S for statements, T for types */
export interface Target<E, S, T> {
  readonly expr: ExprHandlers<E, S, T>
  readonly statement: StatementHandlers<E, S, T>
  readonly type: TypeHandlers<E, S, T>
}

export const makeEmit = <E, S, T>(target: Target<E, S, T>, names: BindingNames): Emit<E, S, T> => {
  const dispatch = <R>(
    handlers: { readonly [kind: string]: (node: never, emit: Emit<E, S, T>) => R },
    node: unknown,
    domain: string,
  ): R => {
    const kind = (node as { readonly kind?: unknown } | null)?.kind
    if (typeof kind !== "string") throw new Error(`expected an IR node, got ${node === null ? "null" : typeof node}`)
    const handler = handlers[kind]
    if (handler === undefined) throw new Error(`no ${domain} handler for "${kind}"`)
    return handler(node as never, emit)
  }

  const emit: Emit<E, S, T> = {
    expr: (node) => dispatch(target.expr, node, "expression"),
    statement: (node) => dispatch(target.statement, node, "statement"),
    block: (body) => body.statements.map(emit.statement),
    type: (node) => dispatch(target.type, node, "type"),
    bindingName: (id, name) => names.get(id) ?? name,
  }
  return emit
}
