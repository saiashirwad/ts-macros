import { isNode, type NodeLike } from "./pipeable.ts"

export type Visitor = (node: NodeLike) => void

/**
 * Traverses an IR tree soundly:
 * - Only visits real branded IR nodes (ignoring user data that happens to have a `tag` field)
 * - Guards against cycles with a WeakSet
 */
export const walk = (
  root: unknown,
  visit: Visitor,
  visited = new WeakSet<object>(),
): void => {
  if (root === null || typeof root !== "object") return
  if (visited.has(root)) return
  visited.add(root)

  if (isNode(root)) {
    visit(root)
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      walk(item, visit, visited)
    }
  } else {
    for (const key of Object.keys(root)) {
      if (key === "type" || key === "returnType") continue
      walk((root as Record<string, unknown>)[key], visit, visited)
    }
  }
}
