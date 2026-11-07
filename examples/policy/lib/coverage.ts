import type * as $ from "../../../src/index.ts"
import { reads } from "./analyze.ts"
import { asExpr, literalOf, nodesOf } from "./ast.ts"
import { evaluate } from "./evaluate.ts"
import type { Evidence, Policy, Requirement, World } from "./policy.ts"

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing a literal to a string is the point
const isString = (value: string | number | boolean | null | undefined): value is string => typeof value === "string"

const startsAt = "2026-06-01"
const certs = { missing: undefined, expired: "2026-01-01", valid: "2027-01-01" }

type Cert = keyof typeof certs

export interface Scenario {
  readonly name: string
  readonly world: World
  readonly requirements: Requirement[]
}

/** the strings a placement field is compared with, plus one value that matches none of them */
const candidates = (policy: Policy, key: string): string[] => {
  const values = new Set<string>(["other"])
  for (const node of nodesOf(policy)) {
    if (node.kind !== "binary" || (node.op !== "===" && node.op !== "!==")) continue
    for (const [side, other] of [[node.left, node.right], [node.right, node.left]] as const) {
      const prop = asExpr(side)
      const value = literalOf(other)
      if (prop.kind === "prop" && prop.key === key && isString(value)) values.add(value)
    }
  }
  return [...values]
}

const worldOf = (job: string, state: string, kinds: readonly string[], cert: Cert): World => {
  const expiresAt = certs[cert]
  const evidence: Evidence[] = expiresAt ? kinds.map((kind) => ({ worker: "w", kind, expiresAt })) : []
  return { placement: { workerId: "w", job, state, startsAt }, evidence }
}

const branchesOf = (policy: Policy): $.IfClause[] => nodesOf(policy).flatMap((node) => (node.kind === "if" ? node.clauses : []))

/** the fewest generated worlds that take every condition both ways, plus the branches no world can reach */
export interface Coverage {
  readonly chosen: Scenario[]
  readonly unreachable: string[]
}

export const generateScenarios = (policy: Policy): Coverage => {
  const kinds = reads(policy).filter((read) => read.startsWith("evidence.")).map((read) => read.slice("evidence.".length))
  const runs = candidates(policy, "job").flatMap((job) =>
    candidates(policy, "state").flatMap((state) =>
      // SAFETY: Object.keys of `certs` are exactly the Cert names.
      (Object.keys(certs) as Cert[]).map((cert) => {
        const world = worldOf(job, state, kinds, cert)
        const seen = new Map<$.IfClause, Set<boolean>>()
        const requirements = evaluate(policy, world, (clause, taken) => seen.set(clause, (seen.get(clause) ?? new Set()).add(taken)))
        const covered = [...seen].flatMap(([clause, takens]) => [...takens].map((taken) => `${branchesOf(policy).indexOf(clause)}:${taken}`))
        return { scenario: { name: `${job}/${state}/cert ${cert}`, world, requirements }, covered }
      })
    )
  )

  const wanted = new Set(branchesOf(policy).flatMap((_, index) => [`${index}:true`, `${index}:false`]))
  const chosen: Scenario[] = []
  while (true) {
    const best = runs.map((run) => ({ run, gain: run.covered.filter((pair) => wanted.has(pair)).length })).sort((a, b) => b.gain - a.gain)[0]
    if (!best || best.gain === 0) break
    best.run.covered.forEach((pair) => wanted.delete(pair))
    chosen.push(best.run.scenario)
  }
  return { chosen, unreachable: [...wanted].map((pair) => `condition ${pair.replace(":", " is never ")}`) }
}
