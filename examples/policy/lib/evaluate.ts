import type * as $ from "../../../src/index.ts"
import type { Evidence, Json, Policy, Requirement, World } from "./policy.ts"

// SAFETY: operands are plain JSON values; JS operator semantics apply, as in stage 2.
export const operators = {
  "+": (l, r) => l + r,
  "-": (l, r) => l - r,
  "*": (l, r) => l * r,
  "/": (l, r) => l / r,
  "%": (l, r) => l % r,
  "===": (l, r) => l === r,
  "!==": (l, r) => l !== r,
  "<": (l, r) => l < r,
  "<=": (l, r) => l <= r,
  ">": (l, r) => l > r,
  ">=": (l, r) => l >= r,
} satisfies Record<string, (left: any, right: any) => Json>

/** `onBranch` sees every condition as it is tested */
export const evaluate = (
  policy: Policy,
  world: World,
  onBranch?: (clause: $.IfClause, taken: boolean) => void,
): Requirement[] => {
  const required = new Set<Requirement>()
  const host = {
    placement: () => world.placement,
    findEvidence: ({ worker, kind }: { worker: string; kind: string }) =>
      world.evidence.find((item) => item.worker === worker && item.kind === kind) ?? null,
    validAt: (evidence: Evidence | null, at: string) => evidence !== null && evidence.expiresAt >= at,
    require: (requirement: Requirement) => void required.add(requirement),
  }
  const scope = new Map<string, Json>()

  const expr = (input: $.Expr<any>): Json => {
    // SAFETY: restrict() rejected every kind outside the policy subset.
    const node = input as $.AnyExpr
    switch (node.kind) {
      case "literal":
        return node.value
      case "ref":
        return scope.get(node.id) ?? null
      case "prop":
        // SAFETY: stage 1 only allows `prop` on objects.
        return (expr(node.object) as { [key: string]: Json })[node.key] ?? null
      case "object":
        return Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, expr(value)]))
      case "array":
        return node.elements.map(expr)
      case "unary":
        return !expr(node.operand)
      case "cond":
        return expr(node.condition) ? expr(node.then) : expr(node.else)
      case "call": {
        // SAFETY: restrict() only admits known externals as callees, and stage 1 checked the arguments.
        const call = host[(node.callee as $.ExternalExpr).name as keyof typeof host] as (...args: Json[]) => Json
        return call(...node.args.map(expr))
      }
      case "binary": {
        const left = expr(node.left)
        if (node.op === "&&") return left && expr(node.right)
        if (node.op === "||") return left || expr(node.right)
        // SAFETY: restrict() admitted only operators in the table or the short-circuit pair handled above.
        return operators[node.op as keyof typeof operators](left, expr(node.right))
      }
      default:
        throw new Error(`cannot evaluate "${node.kind}"`)
    }
  }

  const run = (statements: ReadonlyArray<$.Statement<"built">>): void => {
    for (const statement of statements) {
      switch (statement.kind) {
        case "const-declaration":
          scope.set(statement.id, statement.expr === undefined ? null : expr(statement.expr))
          break
        case "expr-statement":
          expr(statement.expr)
          break
        case "if": {
          let taken = statement.else
          for (const clause of statement.clauses) {
            const hit = Boolean(expr(clause.condition))
            onBranch?.(clause, hit)
            if (!hit) continue
            taken = clause.body
            break
          }
          if (taken) run(taken.statements)
          break
        }
        default:
          throw new Error(`cannot run "${statement.kind}"`)
      }
    }
  }

  run(policy.statements)
  return [...required]
}
