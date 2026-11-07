import * as $ from "../../../src/index.ts"
import { fieldsOf, hostCall, literalOf, nodesOf } from "./ast.ts"
import { Expr, Policy } from "./policy.ts"

export interface DomainConfig {
  readonly jobs: readonly string[]
  readonly states: readonly string[]
  readonly evidence: readonly string[]
  readonly requirements: readonly string[]
  readonly tasks: readonly string[]
  readonly dates: readonly string[]
}

type Of<C extends DomainConfig, K extends keyof DomainConfig> = C[K][number]

export type DomainPlacement<C extends DomainConfig> = {
  readonly workerId: string
  readonly job: Of<C, "jobs">
  readonly state: Of<C, "states">
  readonly startsAt: string
}
export type DomainEvidence<C extends DomainConfig> = {
  readonly worker: string
  readonly kind: Of<C, "evidence">
  readonly expiresAt: string
}
export type DomainWorker<C extends DomainConfig> = { readonly id: string } & { readonly [D in Of<C, "dates">]: number }

export interface Credential<C extends DomainConfig> {
  readonly jobs: readonly Of<C, "jobs">[]
  readonly evidence: Of<C, "evidence">
  readonly requirement: Of<C, "requirements">
}

type Step = Exclude<$.NonLoopStatement, $.ReturnStatement>
type Const<A> = $.BindingBuilder<A, "const", false>

/** the builders and rule macros of one company's vocabulary */
export interface Domain<C extends DomainConfig> {
  readonly config: C
  placement(): Const<DomainPlacement<C>>
  evidence: {
    find(query: { worker: $.In<string>; kind: Of<C, "evidence"> }): Const<DomainEvidence<C> | null>
    validAt(evidence: $.Expr<DomainEvidence<C> | null>, at: $.In<string>): Const<boolean>
  }
  require(requirement: Of<C, "requirements">): $.ExprStatement
  today(): Const<number>
  worker(): Const<DomainWorker<C>>
  assign(task: Of<C, "tasks">): $.ExprStatement
  when: typeof $.if
  elseWhen: typeof $.elseIf
  otherwise: typeof $.else
  requireFor(jobs: readonly Of<C, "jobs">[], requirement: Of<C, "requirements">): Generator<Step, void, unknown>
  requireUnlessEvidence(credential: Credential<C>): Generator<Step, void, unknown>
  perState(table: { readonly [S in Of<C, "states">]?: Of<C, "requirements"> }): Generator<Step, void, unknown>
  deserialize(artifact: string): Policy
}

const host = {
  placement: $.hostValue<() => { workerId: string; job: string; state: string; startsAt: string }>("placement"),
  findEvidence: $.hostValue<(query: { worker: string; kind: string }) => { worker: string; kind: string; expiresAt: string } | null>("findEvidence"),
  validAt: $.hostValue<(evidence: { worker: string; kind: string; expiresAt: string } | null, at: string) => boolean>("validAt"),
  require: $.hostValue<(requirement: string) => void>("require"),
  today: $.hostValue<() => number>("today"),
  worker: $.hostValue<() => { id: string }>("worker"),
  assign: $.hostValue<(task: string) => void>("assign"),
}

type Held = { worker: string; kind: string; expiresAt: string } | null

type Vocabulary = string | number | boolean | null | undefined

const build = <C extends DomainConfig>(config: C) => {
  const placement = () => $.const("placement", $.call(host.placement))
  const find = (query: { worker: $.In<string>; kind: string }) => $.const("evidence", $.call(host.findEvidence, query))
  const validAt = (evidence: $.Expr<Held>, at: $.In<string>) => $.const("valid", $.call(host.validAt, evidence, at))
  const require = (requirement: string) => $.do($.call(host.require, requirement))

  function* requireFor(jobs: readonly string[], requirement: string) {
    const subject = yield* placement()
    for (const job of jobs) {
      yield* $.if(Expr.eq(Expr.prop(subject, "job"), job), function*() {
        yield* require(requirement)
      })
    }
  }

  function* requireUnlessEvidence({ jobs, evidence, requirement }: { jobs: readonly string[]; evidence: string; requirement: string }) {
    const subject = yield* placement()
    const held = yield* find({ worker: Expr.prop(subject, "workerId"), kind: evidence })
    const valid = yield* validAt(held, Expr.prop(subject, "startsAt"))
    for (const job of jobs) {
      yield* $.if(Expr.and(Expr.eq(Expr.prop(subject, "job"), job), Expr.not(valid)), function*() {
        yield* require(requirement)
      })
    }
  }

  function* perState(table: Readonly<Record<string, string>>) {
    const subject = yield* placement()
    for (const state of config.states) {
      const requirement = table[state]
      if (requirement === undefined) continue
      yield* $.if(Expr.eq(Expr.prop(subject, "state"), state), function*() {
        yield* require(requirement)
      })
    }
  }

  const holds = (vocabulary: readonly string[], kind: string, value: Vocabulary) => {
    if (!vocabulary.includes(String(value))) throw new Error(`unknown ${kind} "${String(value)}"`)
  }

  const deserialize = (artifact: string): Policy => {
    const policy = Policy.deserialize(artifact)
    for (const node of nodesOf(policy)) {
      const call = node.kind === "call" ? hostCall(node) : undefined
      if (call?.name === "require") holds(config.requirements, "requirement", literalOf(call.args[0]))
      if (call?.name === "assign") holds(config.tasks, "task", literalOf(call.args[0]))
      if (call?.name === "findEvidence") holds(config.evidence, "evidence kind", literalOf(fieldsOf(call.args[0]).kind))
    }
    return policy
  }

  return {
    config,
    placement,
    evidence: { find, validAt },
    require,
    today: () => $.const("today", $.call(host.today)),
    worker: () => $.const("worker", $.call(host.worker)),
    assign: (task: string) => $.do($.call(host.assign, task)),
    when: $.if,
    elseWhen: $.elseIf,
    otherwise: $.else,
    requireFor,
    requireUnlessEvidence,
    perState,
    deserialize,
  }
}

/** a company's vocabulary, and the typed builders and rule macros that speak it */
export const defineDomain = <const C extends DomainConfig>(config: C): Domain<C> => {
  // SAFETY: `build` accepts any vocabulary as strings; Domain<C> narrows the same functions to config's literals at the boundary.
  return build(config) as Domain<C>
}
