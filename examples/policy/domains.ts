import { defineDomain } from "./lib/domain.ts"

export const warehouse = defineDomain({
  jobs: ["forklift", "picker", "cleaner"],
  states: ["IL", "CA", "TX", "NY"],
  evidence: ["forklift-certification", "background-check"],
  requirements: ["forklift-certification", "safety-training", "background-check", "il-w4", "ca-wage-theft-notice", "tx-new-hire-report"],
  tasks: ["i9-supplement-b", "permit-reminder"],
  dates: ["permitExpiresDay"],
})

export const hospital = defineDomain({
  jobs: ["nurse", "phlebotomist", "porter"],
  states: ["IL", "CA", "NY"],
  evidence: ["rn-license", "tb-test", "hep-b-vaccine"],
  requirements: ["rn-license", "tb-test", "hep-b-vaccine", "hipaa-training", "ny-mandated-reporter"],
  tasks: ["license-renewal-reminder"],
  dates: ["licenseExpiresDay"],
})
