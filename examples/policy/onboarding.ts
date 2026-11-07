import { defineDomain } from "./lib/domain.ts"
import { type Evidence, Expr, type Placement, Policy } from "./lib/policy.ts"

// 1. The company's vocabulary.
const depot = defineDomain({
  jobs: ["forklift", "driver", "cleaner"],
  states: ["IL", "CA"],
  evidence: ["forklift-certification", "cdl", "background-check"],
  requirements: ["forklift-certification", "cdl", "background-check", "safety-training", "general-orientation", "il-w4"],
  tasks: [],
  dates: [],
})

// 2. A policy on top: branch on the job, and inside a job on the worker's evidence.
const policy = Policy.gen(function*() {
  const placement = yield* depot.placement()
  const job = Expr.prop(placement, "job")
  const worker = Expr.prop(placement, "workerId")
  const startsAt = Expr.prop(placement, "startsAt")

  const certification = yield* depot.evidence.find({ worker, kind: "forklift-certification" })
  const certified = yield* depot.evidence.validAt(certification, startsAt)
  const license = yield* depot.evidence.find({ worker, kind: "cdl" })
  const licensed = yield* depot.evidence.validAt(license, startsAt)

  yield* depot.perState({ IL: "il-w4" })
  yield* depot.requireUnlessEvidence({ jobs: ["forklift", "driver"], evidence: "background-check", requirement: "background-check" })

  yield* depot.when(Expr.eq(job, "forklift"), function*() {
    yield* depot.require("safety-training")
    yield* depot.when(Expr.not(certified), function*() {
      yield* depot.require("forklift-certification")
    })
  }).pipe(
    depot.elseWhen(Expr.eq(job, "driver"), function*() {
      yield* depot.when(Expr.not(licensed), function*() {
        yield* depot.require("cdl")
      })
    }),
    depot.otherwise(function*() {
      yield* depot.require("general-orientation")
    }),
  )
})

// 3. Serialize it, then read it back. The vocabulary rejects names the company never defined.
const artifact = Policy.serialize(policy)
const restored = depot.deserialize(artifact)
console.log(`${artifact.length} bytes of plain JSON\n`)

// 4. Evaluate the restored policy for some workers.
const evidence: Evidence[] = [
  { worker: "ana", kind: "forklift-certification", expiresAt: "2027-01-01" },
  { worker: "ana", kind: "background-check", expiresAt: "2027-01-01" },
]
const workers: Placement[] = [
  { workerId: "ana", job: "forklift", state: "IL", startsAt: "2026-06-01" },
  { workerId: "bo", job: "driver", state: "CA", startsAt: "2026-06-01" },
  { workerId: "cy", job: "cleaner", state: "IL", startsAt: "2026-06-01" },
]

for (const placement of workers) {
  const needs = Policy.evaluate(restored, { placement, evidence })
  console.log(`${placement.workerId} ${placement.job.padEnd(8)} ${placement.state}  ${needs.join(", ") || "nothing"}`)
}
