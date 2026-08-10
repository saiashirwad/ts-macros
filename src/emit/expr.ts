import * as t from "@babel/types"

import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import { assertNever, ident } from "./shared.ts"
import { blockToBabel, paramToBabel } from "./statement.ts"
import { typeExprToBabel } from "./type.ts"

export const exprToBabel = (expr: Expr.Expr<any>): t.Expression => {
  const node = expr as Expr.Any | Fn.Any
  switch (node.tag) {
    case "literal":
      return typeof node.value === "string"
        ? t.stringLiteral(node.value)
        : typeof node.value === "number"
        ? t.numericLiteral(node.value)
        : typeof node.value === "boolean"
        ? t.booleanLiteral(node.value)
        : assertNever(node.value)
    case "var-ref":
    case "function-ref":
    case "generic-function-ref":
      return ident(node.name, node.tag)
    case "prop":
      return t.memberExpression(exprToBabel(node.object), ident(node.key, "prop key"))
    case "index":
      return t.memberExpression(exprToBabel(node.object), exprToBabel(node.index), true)
    case "array":
      return t.arrayExpression(node.elements.map(exprToBabel))
    // integer-like keys reorder at the data level (Object.entries); __proto__ is lost at construction
    case "object":
      return t.objectExpression(
        Object.entries(node.fields).map(([key, value]) => t.objectProperty(ident(key, "object field"), exprToBabel(value))),
      )
    case "call-expr":
      return t.callExpression(exprToBabel(node.callee), node.args.map(exprToBabel))
    case "instantiation":
      return t.tsInstantiationExpression(
        exprToBabel(node.callee),
        t.tsTypeParameterInstantiation(node.typeArgs.map(typeExprToBabel)),
      )
    case "arrow":
      return t.arrowFunctionExpression(node.params.map(paramToBabel), blockToBabel(node.body))
    case "binary": {
      const left = exprToBabel(node.left)
      const right = exprToBabel(node.right)
      return node.op === "&&" || node.op === "||"
        ? t.logicalExpression(node.op, left, right)
        : t.binaryExpression(node.op, left, right)
    }
    case "unary":
      return t.unaryExpression(node.op, exprToBabel(node.operand))
    case "template": {
      if (node.parts.length !== node.exprs.length + 1) {
        throw new Error(
          `cannot emit a template with ${node.parts.length} parts and ${node.exprs.length} exprs`
            + ` (expected ${node.exprs.length + 1} parts)`,
        )
      }
      return t.templateLiteral(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map(exprToBabel),
      )
    }
    case "cond":
      return t.conditionalExpression(exprToBabel(node.condition), exprToBabel(node.then), exprToBabel(node.else))
    case "assign":
      return t.assignmentExpression("=", exprToBabel(node.target) as t.LVal, exprToBabel(node.value))
    default:
      return assertNever(node)
  }
}
