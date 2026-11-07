import type * as $ from "../../../src/index.ts"
import { type ValueNode, walk } from "../../../src/walk.ts"
import type { Policy } from "./policy.ts"

export const asExpr = (expr: $.Expr<any>): $.AnyExpr => {
  // SAFETY: restrict() admits only node kinds that are expression kinds when they sit in expression position.
  return expr as $.AnyExpr
}

export const nodesOf = (policy: Policy): ValueNode[] => {
  const nodes: ValueNode[] = []
  // SAFETY: a built statement list is a list of value nodes.
  walk(policy.statements as ValueNode[], (node) => void nodes.push(node))
  return nodes
}

/** what each `const` was bound to, by binding id */
export const definitions = (policy: Policy): Map<string, $.Expr<any>> => {
  const defs = new Map<string, $.Expr<any>>()
  for (const node of nodesOf(policy)) if (node.kind === "const-declaration" && node.expr) defs.set(node.id, node.expr)
  return defs
}

export interface HostCall {
  readonly name: string
  readonly args: ReadonlyArray<$.Expr<any>>
}

export const hostCall = (expr: $.Expr<any>): HostCall | undefined => {
  const node = asExpr(expr)
  if (node.kind !== "call") return undefined
  const callee = asExpr(node.callee)
  return callee.kind === "external" ? { name: callee.name, args: node.args } : undefined
}

export const literalOf = (expr: $.Expr<any> | undefined): string | number | boolean | null | undefined => {
  const node = expr && asExpr(expr)
  return node?.kind === "literal" ? node.value : undefined
}

/** the field expressions of an object literal argument */
export const fieldsOf = (expr: $.Expr<any> | undefined): Record<string, $.Expr<any>> => {
  const node = expr && asExpr(expr)
  return node?.kind === "object" ? node.fields : {}
}
