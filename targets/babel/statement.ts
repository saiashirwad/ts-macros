import * as t from "@babel/types"

import type { BindingNames } from "../../src/emit/names.ts"
import { resolveBindingName } from "../../src/emit/names.ts"
import type * as Fn from "../../src/function.ts"
import type { Block, IfClause, Statement } from "../../src/statement.ts"
import type * as Type from "../../src/types/index.ts"
import { exprToBabel } from "./expr.ts"
import { assertNever, ident } from "./shared.ts"
import { typeExprToBabel } from "./type.ts"

export const blockToBabel = (block: Block, names?: BindingNames): t.BlockStatement =>
  t.blockStatement(block.statements.map((statement) => statementToBabel(statement, names)))

export const paramToBabel = (param: Fn.AnyParam, names?: BindingNames): t.Identifier | t.RestElement => {
  const name = resolveBindingName(names, param.id, param.nameHint)
  const id = ident(name, `param "${param.nameHint}"`)
  const annotation = t.tsTypeAnnotation(typeExprToBabel(param.type))
  switch (param.kind) {
    // babel prints a rest param's annotation off the RestElement, not its argument
    case "rest": {
      const rest = t.restElement(id)
      rest.typeAnnotation = annotation
      return rest
    }
    case "optional":
      id.optional = true
      id.typeAnnotation = annotation
      return id
    default:
      id.typeAnnotation = annotation
      return id
  }
}

const typeParamsToBabel = (typeParams: Type.AnyParams): t.TSTypeParameterDeclaration | null =>
  typeParams.length === 0
    ? null
    : t.tsTypeParameterDeclaration(
      typeParams.map((param) => t.tsTypeParameter(param.extends === undefined ? null : typeExprToBabel(param.extends), null, param.name)),
    )

const ifToBabel = (
  clauses: ReadonlyArray<IfClause>,
  elseBlock: Block | null,
  index: number,
  names?: BindingNames,
): t.IfStatement => {
  const clause = clauses[index]!
  return t.ifStatement(
    exprToBabel(clause.condition, names),
    blockToBabel(clause.body, names),
    index + 1 < clauses.length
      ? ifToBabel(clauses, elseBlock, index + 1, names)
      : elseBlock === null
      ? null
      : blockToBabel(elseBlock, names),
  )
}

export const statementToBabel = (statement: Statement, names?: BindingNames): t.Statement => {
  switch (statement.tag) {
    case "let-declaration":
    case "const-declaration": {
      const name = resolveBindingName(names, statement.id, statement.nameHint)
      const id = ident(name, statement.tag)
      if (statement.annotation !== undefined) {
        id.typeAnnotation = t.tsTypeAnnotation(typeExprToBabel(statement.annotation))
      }
      return t.variableDeclaration(statement.tag === "let-declaration" ? "let" : "const", [
        t.variableDeclarator(id, statement.expr === undefined ? null : exprToBabel(statement.expr, names)),
      ])
    }
    case "function-declaration": {
      if (statement.body === undefined) {
        throw new Error(`Cannot emit function ${statement.nameHint} without an implementation`)
      }
      const name = resolveBindingName(names, statement.id, statement.nameHint)
      const declaration = t.functionDeclaration(
        ident(name, "function-declaration"),
        statement.params.map((param: Fn.AnyParam) => paramToBabel(param, names)),
        blockToBabel(statement.body, names),
      )
      declaration.typeParameters = typeParamsToBabel(statement.typeParams)
      declaration.returnType = statement.returnType === undefined
        ? null
        : t.tsTypeAnnotation(typeExprToBabel(statement.returnType))
      return declaration
    }
    case "type-declaration":
      if (statement.body === undefined) {
        throw new Error(`Cannot emit type ${statement.name} without a body`)
      }
      return t.tsTypeAliasDeclaration(
        ident(statement.name, "type-declaration"),
        typeParamsToBabel(statement.params),
        typeExprToBabel(statement.body),
      )
    case "return":
      return t.returnStatement(exprToBabel(statement.value, names))
    case "throw":
      return t.throwStatement(exprToBabel(statement.value, names))
    case "expr-statement":
      return t.expressionStatement(exprToBabel(statement.expr, names))
    case "assign":
      return t.expressionStatement(exprToBabel(statement, names))
    case "break":
      return t.breakStatement()
    case "continue":
      return t.continueStatement()
    case "if":
      return ifToBabel(statement.clauses, statement.else, 0, names)
    case "while":
      return t.whileStatement(exprToBabel(statement.condition, names), blockToBabel(statement.body, names))
    case "for-of": {
      const name = resolveBindingName(names, statement.id, statement.nameHint)
      return t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(ident(name, "for-of"))]),
        exprToBabel(statement.iterable, names),
        blockToBabel(statement.body, names),
      )
    }
    default:
      return assertNever(statement)
  }
}
