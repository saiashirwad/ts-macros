import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { warehouse } from "./domains.ts"
import { type Evidence, type Placement, Policy } from "./lib/policy.ts"

const onboarding = Policy.gen(function*() {
  yield* warehouse.perState({ IL: "il-w4", CA: "ca-wage-theft-notice", TX: "tx-new-hire-report" })
  yield* warehouse.requireUnlessEvidence({ jobs: ["forklift", "picker"], evidence: "background-check", requirement: "background-check" })
  yield* warehouse.requireFor(["forklift"], "safety-training")
  yield* warehouse.requireUnlessEvidence({ jobs: ["forklift"], evidence: "forklift-certification", requirement: "forklift-certification" })
})

const file = join(mkdtempSync(join(tmpdir(), "policy-")), "onboarding.policy.json")
writeFileSync(file, Policy.serialize(onboarding))
const restored = warehouse.deserialize(readFileSync(file, "utf8"))
console.log(`${file}\n${readFileSync(file).length} bytes, no source or closures inside\n`)

const evidence: Evidence[] = [
  { worker: "ana", kind: "forklift-certification", expiresAt: "2027-01-01" },
  { worker: "ana", kind: "background-check", expiresAt: "2027-01-01" },
  { worker: "bo", kind: "forklift-certification", expiresAt: "2025-01-01" },
  { worker: "di", kind: "background-check", expiresAt: "2025-06-01" },
]

const workers: Placement[] = [
  { workerId: "ana", job: "forklift", state: "IL", startsAt: "2026-06-01" },
  { workerId: "bo", job: "forklift", state: "TX", startsAt: "2026-06-01" },
  { workerId: "cy", job: "picker", state: "CA", startsAt: "2026-06-01" },
  { workerId: "di", job: "picker", state: "CA", startsAt: "2026-06-01" },
  { workerId: "ed", job: "cleaner", state: "NY", startsAt: "2026-06-01" },
]

for (const placement of workers) {
  const needs = Policy.evaluate(restored, { placement, evidence })
  console.log(`${placement.workerId} ${placement.job.padEnd(8)} ${placement.state}  ${needs.join(", ") || "nothing"}`)
}
