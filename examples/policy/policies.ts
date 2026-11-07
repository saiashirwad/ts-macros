import { warehouse } from "./domains.ts"
import { Expr, Policy, type World } from "./lib/policy.ts"

export const v1 = Policy.gen(function*() {
  yield* warehouse.requireUnlessEvidence({ jobs: ["forklift"], evidence: "forklift-certification", requirement: "forklift-certification" })
})

export const v2 = Policy.gen(function*() {
  yield* warehouse.requireFor(["forklift"], "safety-training")
  yield* warehouse.requireUnlessEvidence({ jobs: ["forklift"], evidence: "forklift-certification", requirement: "forklift-certification" })
  yield* warehouse.requireFor(["forklift", "picker"], "background-check")
})

export const permits = Policy.gen(function*() {
  const today = yield* warehouse.today()
  const worker = yield* warehouse.worker()
  const expires = Expr.prop(worker, "permitExpiresDay")

  yield* warehouse.when(Expr.gte(today, Expr.sub(expires, 30)), function*() {
    yield* warehouse.assign("i9-supplement-b")
  })
  yield* warehouse.when(Expr.and(Expr.gte(today, Expr.sub(expires, 7)), Expr.lte(today, expires)), function*() {
    yield* warehouse.assign("permit-reminder")
  })
})

export const byState = Policy.gen(function*() {
  yield* warehouse.perState({ IL: "il-w4", CA: "ca-wage-theft-notice", TX: "tx-new-hire-report" })
})

const evidence = [
  { worker: "ana", kind: "forklift-certification", expiresAt: "2027-01-01" },
  { worker: "bo", kind: "forklift-certification", expiresAt: "2025-01-01" },
]
const at = "2026-06-01"

export const worlds = {
  "ana (forklift, valid cert)": { placement: { workerId: "ana", job: "forklift", state: "IL", startsAt: at }, evidence },
  "bo (forklift, expired cert)": { placement: { workerId: "bo", job: "forklift", state: "IL", startsAt: at }, evidence },
  "cy (forklift, no cert)": { placement: { workerId: "cy", job: "forklift", state: "IL", startsAt: at }, evidence },
  "di (picker)": { placement: { workerId: "di", job: "picker", state: "IL", startsAt: at }, evidence },
  "ed (cleaner)": { placement: { workerId: "ed", job: "cleaner", state: "IL", startsAt: at }, evidence },
} satisfies Record<string, World>
