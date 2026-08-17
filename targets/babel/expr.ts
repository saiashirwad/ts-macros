import * as t from "@babel/types"

import type { ExprHandlers } from "../../src/emit/target.ts"
import type * as Expr from "../../src/expr.ts"
import { assertNever, ident } from "./shared.ts"
import { blockToBabel, paramToBabel } from "./statement.ts"

export const babelExpressions: ExprHandlers<t.Expression, t.Statement, t.TSType> = {
  literal: (node) =>
    typeof node.value === "string"
      ? t.stringLiteral(node.value)
      : typeof node.value === "number"
      ? t.numericLiteral(node.value)
      : typeof node.value === "boolean"
      ? t.booleanLiteral(node.value)
      : assertNever(node.value),
  "external-ref": (node) => ident(node.name, node.tag),
  "var-ref": (node, emit) => ident(emit.bindingName(node.target, node.nameHint), node.tag),
  "function-ref": (node, emit) => ident(emit.bindingName(node.target, node.nameHint), node.tag),
  "generic-function-ref": (node, emit) => ident(emit.bindingName(node.target, node.nameHint), node.tag),
  prop: (node, emit) => t.memberExpression(emit.expr(node.object), ident(node.key, "prop key")),
  index: (node, emit) => t.memberExpression(emit.expr(node.object), emit.expr(node.index), true),
  array: (node, emit) => t.arrayExpression(node.elements.map((element: Expr.Expr<any>) => emit.expr(element))),
  // integer-like keys reorder at the data level (Object.entries); __proto__ is lost at construction
  object: (node, emit) =>
    t.objectExpression(
      Object.entries(node.fields).map(([key, value]) => t.objectProperty(ident(key, "object field"), emit.expr(value))),
    ),
  "call-expr": (node, emit) => t.callExpression(emit.expr(node.callee), node.args.map((argument) => emit.expr(argument))),
  instantiation: (node, emit) =>
    t.tsInstantiationExpression(
      emit.expr(node.callee),
      t.tsTypeParameterInstantiation(node.typeArgs.map((argument) => emit.type(argument))),
    ),
  arrow: (node, emit) =>
    t.arrowFunctionExpression(
      node.params.map((param) => paramToBabel(emit, param)),
      blockToBabel(emit, node.body),
    ),
  binary: (node, emit) => {
    const left = emit.expr(node.left)
    const right = emit.expr(node.right)
    return node.op === "&&" || node.op === "||"
      ? t.logicalExpression(node.op, left, right)
      : t.binaryExpression(node.op, left, right)
  },
  unary: (node, emit) => t.unaryExpression(node.op, emit.expr(node.operand)),
  template: (node, emit) => {
    if (node.parts.length !== node.exprs.length + 1) {
      throw new Error(
        `cannot emit a template with ${node.parts.length} parts and ${node.exprs.length} exprs`
          + ` (expected ${node.exprs.length + 1} parts)`,
      )
    }
    return t.templateLiteral(
      node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
      node.exprs.map((part) => emit.expr(part)),
    )
  },
  cond: (node, emit) =>
    t.conditionalExpression(
      emit.expr(node.condition),
      emit.expr(node.then),
      emit.expr(node.else),
    ),
  assign: (node, emit) => t.assignmentExpression("=", emit.expr(node.target) as t.LVal, emit.expr(node.value)),
}
