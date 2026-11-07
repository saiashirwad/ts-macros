import { hospital, warehouse } from "./domains.ts"
import { Expr, Policy } from "./lib/policy.ts"

export const mistakes = () =>
  Policy.gen(function*() {
    const placement = yield* warehouse.placement()
    const job = Expr.prop(placement, "job")

    // @ts-expect-error "forklift-certificate" is not a Requirement
    yield* warehouse.require("forklift-certificate")

    // @ts-expect-error a placement has no salary
    Expr.prop(placement, "salary")

    // @ts-expect-error job is a string, not a number
    Expr.eq(job, 5)

    // @ts-expect-error a condition must be a boolean
    yield* warehouse.when(job, function*() {})

    // @ts-expect-error validAt wants evidence, not a placement
    yield* warehouse.evidence.validAt(placement, "2026-06-01")

    // @ts-expect-error a task is not a requirement
    yield* warehouse.require("i9-supplement-b")

    // @ts-expect-error a hospital job is not a warehouse job
    yield* warehouse.requireFor(["nurse"], "safety-training")

    // @ts-expect-error a warehouse requirement is not a hospital requirement
    yield* hospital.requireFor(["nurse"], "safety-training")
  })
