import { Policy } from "./lib/policy.ts"
import { byState } from "./policies.ts"

const artifact = Policy.serialize(byState)
const restored = Policy.deserialize(artifact)
console.log(`${artifact.match(/"kind":"if"/g)?.length} flat rules, ${artifact.length} bytes, no loop`)

for (const state of ["IL", "CA", "TX", "NY"]) {
  const placement = { workerId: "w", job: "cleaner", state, startsAt: "2026-06-01" }
  console.log(`${state}: ${Policy.evaluate(restored, { placement, evidence: [] }).join(", ") || "nothing"}`)
}
