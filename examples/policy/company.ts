import { hospital, warehouse } from "./domains.ts"
import { type Evidence, type Placement, Policy } from "./lib/policy.ts"

const clinical = ["nurse", "phlebotomist"] as const

/** a company-specific macro, written on top of the library's */
function* clinicalClearance() {
  for (const evidence of ["tb-test", "hep-b-vaccine"] as const) {
    yield* hospital.requireUnlessEvidence({ jobs: clinical, evidence, requirement: evidence })
  }
}

const onboarding = Policy.gen(function*() {
  yield* clinicalClearance()
  yield* hospital.requireUnlessEvidence({ jobs: ["nurse"], evidence: "rn-license", requirement: "rn-license" })
  yield* hospital.requireFor(["nurse", "phlebotomist", "porter"], "hipaa-training")
  yield* hospital.perState({ NY: "ny-mandated-reporter" })
})

const artifact = Policy.serialize(onboarding)
const restored = hospital.deserialize(artifact)

const evidence: Evidence[] = [
  { worker: "ria", kind: "rn-license", expiresAt: "2027-01-01" },
  { worker: "ria", kind: "tb-test", expiresAt: "2027-01-01" },
]
const staff: Placement[] = [
  { workerId: "ria", job: "nurse", state: "NY", startsAt: "2026-06-01" },
  { workerId: "sam", job: "phlebotomist", state: "IL", startsAt: "2026-06-01" },
  { workerId: "tom", job: "porter", state: "CA", startsAt: "2026-06-01" },
]

for (const placement of staff) {
  const needs = Policy.evaluate(restored, { placement, evidence })
  console.log(`${placement.workerId} ${placement.job.padEnd(13)} ${placement.state}  ${needs.join(", ")}`)
}

try {
  warehouse.deserialize(artifact)
} catch (error) {
  console.log(`\nthe warehouse vocabulary refuses it: ${error instanceof Error ? error.message : error}`)
}
