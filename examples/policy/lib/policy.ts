import * as $ from "../../../src/index.ts"
import { validateScopes } from "../../../src/scope.ts"
import { type ValueNode, walk } from "../../../src/walk.ts"
import { evaluate, operators } from "./evaluate.ts"

export type Placement = { readonly workerId: string; readonly job: string; readonly state: string; readonly startsAt: string }
export type Evidence = { readonly worker: string; readonly kind: string; readonly expiresAt: string }
export type Requirement = string
export type Task = string
export type Worker = Readonly<Record<string, string | number>>
export type World = { readonly placement: Placement; readonly evidence: readonly Evidence[] }

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

type Statements = ReadonlyArray<$.Statement<"built">>

export interface Policy {
  readonly statements: Statements
}

export const Expr = {
  prop: $.prop,
  add: $.add,
  sub: $.sub,
  and: $.and,
  or: $.or,
  not: $.not,
  eq: $.eq,
  neq: $.neq,
  lt: $.lt,
  lte: $.lte,
  gt: $.gt,
  gte: $.gte,
}

/** the part of the ts-macros AST a policy may use; everything else is rejected */
const nodeKinds = new Set([
  "const-declaration",
  "if",
  "expr-statement",
  "block",
  "literal",
  "external",
  "ref",
  "prop",
  "object",
  "array",
  "binary",
  "unary",
  "cond",
  "call",
])
const hostNames = new Set(["placement", "findEvidence", "validAt", "require", "today", "worker", "assign"])

const restrict = (statements: Statements): Policy => {
  // SAFETY: a built statement list is a list of value nodes.
  walk(statements as ValueNode[], (node) => {
    if (!nodeKinds.has(node.kind)) throw new Error(`policies cannot contain "${node.kind}"`)
    if (node.kind === "unary" && node.op !== "!") throw new Error(`policies cannot use unary "${node.op}"`)
    if (node.kind === "binary" && !(node.op in operators || node.op === "&&" || node.op === "||")) throw new Error(`policies cannot use "${node.op}"`)
    if (node.kind === "external" && !hostNames.has(node.name)) throw new Error(`unknown host function "${node.name}"`)
  })
  validateScopes(statements)
  return { statements }
}

// Types and binding flags are stage 1 knowledge; the interpreter needs neither.
const stage1Only = new Set(["type", "annotation", "typeParams", "fresh", "mutable"])

/** binding ids are renumbered in order of appearance, so equal policies serialize equally */
const serialize = (policy: Policy): string => {
  const ids = new Map<string, string>()
  return JSON.stringify(policy.statements, (key, value) => {
    if (stage1Only.has(key)) return undefined
    if (key !== "id") return value
    return ids.get(value) ?? ids.set(value, `b${ids.size}`).get(value)
  })
}

const deserialize = (artifact: string): Policy =>
  // SAFETY: restrict() walks the parsed tree and rejects anything outside the policy subset.
  restrict(JSON.parse(artifact) as Statements)

export const Policy = {
  gen: (body: Parameters<typeof $.build<void>>[0]): Policy => restrict($.build(body).statements),
  serialize,
  deserialize,
  evaluate,
}
