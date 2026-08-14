import type * as Expr from "../expr.ts"
import type { Block, Statement } from "../statement.ts"
import type * as Type from "../types/index.ts"

export type ExprNode = Expr.Any
export type StatementNode = Statement
export type TypeNode = Type.Any

export interface Emit<E, S, T> {
  expr(node: Expr.Expr<any>): E
  statement(node: Statement): S
  block(block: Block): S[]
  type(node: Type.TypeExpr<any>): T
}

export type ExprHandlers<E, S, T> = {
  readonly [K in ExprNode["tag"]]: (node: Extract<ExprNode, { tag: K }>, emit: Emit<E, S, T>) => E
}

export type StatementHandlers<E, S, T> = {
  readonly [K in StatementNode["tag"]]: (node: Extract<StatementNode, { tag: K }>, emit: Emit<E, S, T>) => S
}

export type TypeHandlers<E, S, T> = {
  readonly [K in TypeNode["tag"]]: (node: Extract<TypeNode, { tag: K }>, emit: Emit<E, S, T>) => T
}

export interface Target<E, S, T> {
  readonly expr: ExprHandlers<E, S, T>
  readonly statement: StatementHandlers<E, S, T>
  readonly type: TypeHandlers<E, S, T>
}

export const makeEmit = <E, S, T>(target: Target<E, S, T>): Emit<E, S, T> => {
  const dispatch = <R>(
    handlers: { readonly [tag: string]: (node: never, emit: Emit<E, S, T>) => R },
    node: { readonly tag: string },
    domain: string,
  ): R => {
    const handler = handlers[node.tag]
    if (handler === undefined) throw new Error(`no ${domain} handler for "${node.tag}"`)
    return handler(node as never, emit)
  }
  const emit: Emit<E, S, T> = {
    expr: (node) => dispatch(target.expr, node as ExprNode, "expression"),
    statement: (node) => dispatch(target.statement, node, "statement"),
    block: (block) => block.statements.map(emit.statement),
    type: (node) => dispatch(target.type, node as TypeNode, "type"),
  }
  return emit
}
