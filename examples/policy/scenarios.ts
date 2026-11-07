import { generateScenarios } from "./lib/coverage.ts"
import { byState, v2 } from "./policies.ts"

for (const [name, policy] of Object.entries({ v2, byState })) {
  const { chosen, unreachable } = generateScenarios(policy)
  console.log(`${name}: ${chosen.length} scenarios cover every branch`)
  for (const { name, requirements } of chosen) console.log(`  ${name.padEnd(30)} ${requirements.join(", ") || "nothing"}`)
  for (const branch of unreachable) console.log(`  unreachable: ${branch}`)
}
