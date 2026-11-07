import { affectedBy, reads, requirements } from "./lib/analyze.ts"
import { permits, v1, v2 } from "./policies.ts"

const policies = { v1, v2, permits }
for (const [name, policy] of Object.entries(policies)) console.log(`${name.padEnd(8)} reads ${reads(policy).join(", ")}`)

const before = requirements(v1)
console.log(`\nv2 can newly ask for: ${requirements(v2).filter((r) => !before.includes(r)).join(", ")}`)

for (const change of ["evidence.forklift-certification", "worker.permitExpiresDay", "placement.state"]) {
  console.log(`${change} changes, re-run: ${affectedBy(policies, change).join(", ") || "nothing"}`)
}
