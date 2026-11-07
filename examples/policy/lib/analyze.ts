import { asExpr, definitions, fieldsOf, hostCall, literalOf, nodesOf } from "./ast.ts"
import type { Policy } from "./policy.ts"

/** the data a policy reads, found without running it: `placement.job`, `evidence.<kind>`, `clock` */
export const reads = (policy: Policy): string[] => {
  const defs = definitions(policy)
  const found = new Set<string>()
  for (const node of nodesOf(policy)) {
    if (node.kind === "prop") {
      const object = asExpr(node.object)
      const source = object.kind === "ref" ? hostCall(defs.get(object.id)!)?.name : undefined
      if (source) found.add(`${source}.${node.key}`)
    } else if (node.kind === "call") {
      const call = hostCall(node)!
      if (call.name === "findEvidence") found.add(`evidence.${literalOf(fieldsOf(call.args[0]).kind)}`)
      if (call.name === "today") found.add("clock")
    }
  }
  return [...found].sort()
}

/** every requirement the policy could ever ask for, for any worker */
export const requirements = (policy: Policy): string[] => {
  const found = new Set<string>()
  for (const node of nodesOf(policy)) {
    const call = node.kind === "call" ? hostCall(node) : undefined
    if (call?.name === "require") found.add(String(literalOf(call.args[0])))
  }
  return [...found].sort()
}

/** the policies that must be re-run when this piece of data changes */
export const affectedBy = (policies: Record<string, Policy>, change: string): string[] =>
  Object.keys(policies).filter((name) => reads(policies[name]!).includes(change))
