import { isNode, isType, type Node } from "./node.ts"

export type Visitor = (node: Node) => void

/**
 * Visits every value node under `root`, in pre-order. Only branded nodes are
 * reported, so user data that happens to carry a `kind` is ignored; type
 * nodes are not entered; cycles are guarded with a WeakSet.
 */
export const walk = (root: unknown, visit: Visitor, visited = new WeakSet<object>()): void => {
  if (root === null || typeof root !== "object") return
  if (isType(root) || visited.has(root)) return
  visited.add(root)
  if (isNode(root)) visit(root)
  for (const child of globalThis.Array.isArray(root) ? root : globalThis.Object.values(root)) walk(child, visit, visited)
}
