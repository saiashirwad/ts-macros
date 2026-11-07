import type * as $ from "../../../src/index.ts"
import { asExpr, hostCall } from "./ast.ts"
import { operators } from "./evaluate.ts"
import type { Json, Policy, Task, Worker } from "./policy.ts"

/** the symbolic value `today + offset` */
class Day {
  readonly offset: number
  constructor(offset: number) {
    this.offset = offset
  }
}

/** the days on which a condition holds, as an inclusive range */
class Window {
  readonly from: number
  readonly to: number
  constructor(from: number, to: number) {
    this.from = from
    this.to = to
  }
  and(other: Window): Window {
    return new Window(Math.max(this.from, other.from), Math.min(this.to, other.to))
  }
}

type Value = Json | Day | Window

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- telling a concrete number from a symbolic day is the point
const isNumber = (value: Value): value is number => typeof value === "number"

export interface Fire {
  readonly task: Task
  readonly window: Window
}

const flip = new Map([["<", ">"], ["<=", ">="], [">", "<"], [">=", "<="], ["===", "==="]])

/** `today + offset op bound`, solved for `today` */
const solve = (op: string, offset: number, bound: number): Window => {
  const at = bound - offset
  switch (op) {
    case ">=":
      return new Window(at, Infinity)
    case ">":
      return new Window(at + 1, Infinity)
    case "<=":
      return new Window(-Infinity, at)
    case "<":
      return new Window(-Infinity, at - 1)
    case "===":
      return new Window(at, at)
    default:
      throw new Error(`cannot solve "${op}" for the day`)
  }
}

/** the days on which the policy assigns each task, solved rather than simulated */
export const fireWindows = (policy: Policy, worker: Worker): Fire[] => {
  const scope = new Map<string, Value>()
  const fires: Fire[] = []
  let context = new Window(-Infinity, Infinity)

  const expr = (input: $.Expr<any>): Value => {
    const node = asExpr(input)
    switch (node.kind) {
      case "literal":
        return node.value
      case "ref":
        return scope.get(node.id) ?? null
      case "prop":
        // SAFETY: stage 1 only allows `prop` on objects.
        return (expr(node.object) as { [key: string]: Json })[node.key] ?? null
      case "call": {
        const call = hostCall(node)
        if (call?.name === "today") return new Day(0)
        if (call?.name === "worker") return worker
        if (call?.name === "assign") {
          // SAFETY: stage 1 checked the argument against the Task type.
          fires.push({ task: expr(call.args[0]!) as Task, window: context })
          return null
        }
        throw new Error(`"${call?.name}" is not available to an automation`)
      }
      case "binary": {
        const left = expr(node.left)
        if (node.op === "&&") return left instanceof Window ? both(left, expr(node.right)) : left && expr(node.right)
        const right = expr(node.right)
        if (node.op === "+" || node.op === "-") {
          if (left instanceof Day && isNumber(right)) return new Day(left.offset + (node.op === "+" ? right : -right))
        }
        if (left instanceof Day && isNumber(right)) return solve(node.op, left.offset, right)
        if (isNumber(left) && right instanceof Day) return solve(flip.get(node.op) ?? node.op, right.offset, left)
        if (left instanceof Day || left instanceof Window || right instanceof Day || right instanceof Window) {
          throw new Error(`"${node.op}" on days is outside the solvable fragment`)
        }
        // SAFETY: restrict() admitted only operators in the table or the short-circuit pair.
        return operators[node.op as keyof typeof operators](left, right)
      }
      default:
        throw new Error(`"${node.kind}" is outside the solvable fragment`)
    }
  }

  const both = (left: Window, right: Value): Window => {
    if (!(right instanceof Window)) throw new Error("&& of a day window needs another day window")
    return left.and(right)
  }

  const run = (statements: ReadonlyArray<$.Statement<"built">>): void => {
    for (const statement of statements) {
      if (statement.kind === "const-declaration") scope.set(statement.id, statement.expr ? expr(statement.expr) : null)
      else if (statement.kind === "expr-statement") expr(statement.expr)
      else if (statement.kind === "if") {
        if (statement.clauses.length !== 1 || statement.else) throw new Error("else branches on days are outside the solvable fragment")
        const [clause] = statement.clauses
        const when = expr(clause!.condition)
        const outer = context
        if (when instanceof Window) context = outer.and(when)
        if (when) run(clause!.body.statements)
        context = outer
      } else throw new Error(`cannot run "${statement.kind}"`)
    }
  }

  run(policy.statements)
  return fires.filter(({ window }) => window.from <= window.to)
}

/** the first day on or after `from` that fires, per task */
export const nextFires = (fires: readonly Fire[], from: number): Map<Task, number> => {
  const next = new Map<Task, number>()
  for (const { task, window } of fires) {
    const day = Math.max(window.from, from)
    if (day <= window.to && day < (next.get(task) ?? Infinity)) next.set(task, day)
  }
  return next
}
