export interface TaggedNode {
  readonly tag: string
}

// structural: arrays and objects are entered, so it never needs updating
// when the vocabulary grows. functions are entered only when tagged —
// callable refs are function objects carrying node fields. shared subtrees
// are visited once per reference.
export const walk = (root: unknown, visit: (node: TaggedNode) => void): void => {
  if (root === null || (typeof root !== "object" && typeof root !== "function")) return
  if (Array.isArray(root)) {
    for (const item of root) walk(item, visit)
    return
  }
  const tagged = typeof (root as { readonly tag?: unknown }).tag === "string"
  if (typeof root === "function" && !tagged) return
  if (tagged) visit(root as TaggedNode)
  for (const value of Object.values(root)) walk(value, visit)
}
