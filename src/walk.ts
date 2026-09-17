import { type AstNode, isAstNode, isTypeNode } from "./node.ts"

export type Visitor = (node: AstNode) => void

/**
 * Visits every AST node under `root`, in pre-order. Only branded nodes are
 * reported, so user data that happens to carry a `tag` is ignored; type
 * nodes are not entered; cycles are guarded with a WeakSet.
 */
export const walk = (root: unknown, visit: Visitor, visited = new WeakSet<object>()): void => {
  if (root === null || typeof root !== "object") return
  if (isTypeNode(root) || visited.has(root)) return
  visited.add(root)
  if (isAstNode(root)) visit(root)
  for (const child of Array.isArray(root) ? root : Object.values(root)) walk(child, visit, visited)
}
