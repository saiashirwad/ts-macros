import type * as Expr from "../expr.ts"
import type { ValueBinding, ValueReference } from "../identity.ts"
import type { Statement } from "../statement.ts"

export interface ScopeCursor {
  expression(expression: Expr.Expr<any>): void
  childScope(statements: ReadonlyArray<Statement>, initialBindings?: ReadonlyArray<ValueBinding>): void
  reference(reference: ValueReference): void
}

export interface ValueScopeVisitor<State> {
  enterScope(bindings: ReadonlyArray<ValueBinding>, parent: State): State
  reference(reference: ValueReference, scope: State): void
}

export interface StatementScopeBehavior<Node> {
  bindings(node: Node): ReadonlyArray<ValueBinding>
  visit(node: Node, cursor: ScopeCursor): void
}

type NodeWithTag<Nodes extends { readonly tag: string }, Tag extends Nodes["tag"]> =
    Nodes extends unknown ?
      Tag extends Nodes["tag"] ? Nodes
    : never
  : never

export type ExpressionScopeHandlers<Nodes extends { readonly tag: string }> = {
  readonly [Tag in Nodes["tag"]]: (node: NodeWithTag<Nodes, Tag>, cursor: ScopeCursor) => void
}

export type StatementScopeHandlers<Nodes extends { readonly tag: string }> = {
  readonly [Tag in Nodes["tag"]]: StatementScopeBehavior<NodeWithTag<Nodes, Tag>>
}
