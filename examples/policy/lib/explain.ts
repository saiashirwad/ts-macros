import type * as $ from "../../../src/index.ts"
import { asExpr, definitions, fieldsOf, hostCall, literalOf } from "./ast.ts"
import type { Policy } from "./policy.ts"

const words = new Map([
  ["===", "is"],
  ["!==", "is not"],
  ["<", "is before"],
  ["<=", "is on or before"],
  [">", "is after"],
  [">=", "is on or after"],
  ["&&", "and"],
  ["||", "or"],
  ["+", "plus"],
  ["-", "minus"],
])

/** renders a policy as the sentences a compliance reviewer would read */
export const explain = (policy: Policy): string[] => {
  const defs = definitions(policy)
  const lines: string[] = []

  const phrase = (input: $.Expr<any>): string => {
    const node = asExpr(input)
    switch (node.kind) {
      case "literal":
        return String(node.value)
      case "ref":
        return phrase(defs.get(node.id)!)
      case "prop":
        return `the ${node.key} of ${phrase(node.object)}`
      case "unary":
        return `it is not true that ${phrase(node.operand)}`
      case "binary": {
        const nested = (side: $.Expr<any>) => (asExpr(side).kind === "binary" ? `(${phrase(side)})` : phrase(side))
        return `${nested(node.left)} ${words.get(node.op) ?? node.op} ${nested(node.right)}`
      }
      case "call": {
        const call = hostCall(node)!
        const [first, second] = call.args
        const query = fieldsOf(first)
        switch (call.name) {
          case "placement":
            return "the placement"
          case "worker":
            return "the worker"
          case "today":
            return "today"
          case "findEvidence":
            return `${literalOf(query.kind)} evidence for ${phrase(query.worker!)}`
          case "validAt":
            return `${phrase(first!)} is valid on ${phrase(second!)}`
          default:
            throw new Error(`no wording for "${call.name}"`)
        }
      }
      default:
        throw new Error(`no wording for "${node.kind}"`)
    }
  }

  const run = (statements: ReadonlyArray<$.Statement<"built">>, indent: string): void => {
    for (const statement of statements) {
      if (statement.kind === "expr-statement") {
        const call = hostCall(statement.expr)!
        lines.push(`${indent}${call.name === "require" ? "Require" : "Assign"} ${phrase(call.args[0]!)}.`)
      } else if (statement.kind === "if") {
        statement.clauses.forEach((clause, index) => {
          lines.push(`${indent}${index === 0 ? "When" : "Otherwise, when"} ${phrase(clause.condition)}:`)
          run(clause.body.statements, `${indent}  `)
        })
        if (statement.else) {
          lines.push(`${indent}Otherwise:`)
          run(statement.else.statements, `${indent}  `)
        }
      }
    }
  }

  run(policy.statements, "")
  return lines
}
