import * as t from "@babel/types"

import type { BindingNames } from "../../src/emit/names.ts"
import { resolveBindingName } from "../../src/emit/names.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import { assertNever, ident } from "./shared.ts"
import { blockToBabel, paramToBabel } from "./statement.ts"
import { typeExprToBabel } from "./type.ts"

export const exprToBabel = (expr: Expr.Expr<any>, names?: BindingNames): t.Expression => {
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
    case "external-ref":
      return ident(node.name, node.tag)
    case "var-ref":
    case "function-ref":
    case "generic-function-ref":
      return ident(resolveBindingName(names, node.target, node.nameHint), node.tag)
    case "prop":
      return t.memberExpression(exprToBabel(node.object, names), ident(node.key, "prop key"))
    case "index":
      return t.memberExpression(exprToBabel(node.object, names), exprToBabel(node.index, names), true)
    case "array":
      return t.arrayExpression(node.elements.map((element: Expr.Expr<any>) => exprToBabel(element, names)))
    // integer-like keys reorder at the data level (Object.entries); __proto__ is lost at construction
    case "object":
      return t.objectExpression(
        Object.entries(node.fields).map(([key, value]) => t.objectProperty(ident(key, "object field"), exprToBabel(value, names))),
      )
    case "call-expr":
      return t.callExpression(exprToBabel(node.callee, names), node.args.map((argument) => exprToBabel(argument, names)))
    case "instantiation":
      return t.tsInstantiationExpression(
        exprToBabel(node.callee, names),
        t.tsTypeParameterInstantiation(node.typeArgs.map(typeExprToBabel)),
      )
    case "arrow":
      return t.arrowFunctionExpression(
        node.params.map((param) => paramToBabel(param, names)),
        blockToBabel(node.body, names),
      )
    case "binary": {
      const left = exprToBabel(node.left, names)
      const right = exprToBabel(node.right, names)
      return node.op === "&&" || node.op === "||"
        ? t.logicalExpression(node.op, left, right)
        : t.binaryExpression(node.op, left, right)
    }
    case "unary":
      return t.unaryExpression(node.op, exprToBabel(node.operand, names))
    case "template": {
      if (node.parts.length !== node.exprs.length + 1) {
        throw new Error(
          `cannot emit a template with ${node.parts.length} parts and ${node.exprs.length} exprs`
            + ` (expected ${node.exprs.length + 1} parts)`,
        )
      }
      return t.templateLiteral(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map((part) => exprToBabel(part, names)),
      )
    }
    case "cond":
      return t.conditionalExpression(
        exprToBabel(node.condition, names),
        exprToBabel(node.then, names),
        exprToBabel(node.else, names),
      )
    case "assign":
      return t.assignmentExpression("=", exprToBabel(node.target, names) as t.LVal, exprToBabel(node.value, names))
    default:
      return assertNever(node)
  }
}
