import * as t from "@babel/types"

import type * as Fn from "../function.ts"
import type { Block, IfClause, Statement } from "../statement.ts"
import type * as Type from "../types/index.ts"
import { exprToBabel } from "./expr.ts"
import { assertNever, ident } from "./shared.ts"
import { typeExprToBabel } from "./type.ts"

export const blockToBabel = (block: Block): t.BlockStatement => t.blockStatement(block.statements.map(statementToBabel))

export const paramToBabel = (param: Fn.AnyParam): t.Identifier | t.RestElement => {
  const id = ident(param.name, `param "${param.name}"`)
  const annotation = t.tsTypeAnnotation(typeExprToBabel(param.type))
  switch (param.kind) {
    // babel wants the annotation on RestElement, not the ident
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

const ifToBabel = (clauses: ReadonlyArray<IfClause>, elseBlock: Block | null, index: number): t.IfStatement => {
  const clause = clauses[index]!
  return t.ifStatement(
    exprToBabel(clause.condition),
    blockToBabel(clause.body),
    index + 1 < clauses.length
      ? ifToBabel(clauses, elseBlock, index + 1)
      : elseBlock === null
      ? null
      : blockToBabel(elseBlock),
  )
}

export const statementToBabel = (statement: Statement): t.Statement => {
  switch (statement.tag) {
    case "let-declaration":
    case "const-declaration": {
      const id = ident(statement.name, statement.tag)
      if (statement.annotation !== undefined) {
        id.typeAnnotation = t.tsTypeAnnotation(typeExprToBabel(statement.annotation))
      }
      return t.variableDeclaration(statement.tag === "let-declaration" ? "let" : "const", [
        t.variableDeclarator(id, statement.expr === undefined ? null : exprToBabel(statement.expr)),
      ])
    }
    case "function-declaration": {
      if (statement.body === undefined) {
        throw new Error(`Cannot emit function ${statement.name} without an implementation`)
      }
      const declaration = t.functionDeclaration(
        ident(statement.name, "function-declaration"),
        statement.params.map(paramToBabel),
        blockToBabel(statement.body),
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
      return t.returnStatement(exprToBabel(statement.value))
    case "throw":
      return t.throwStatement(exprToBabel(statement.value))
    case "expr-statement":
      return t.expressionStatement(exprToBabel(statement.expr))
    case "assign":
      return t.expressionStatement(exprToBabel(statement))
    case "break":
      return t.breakStatement()
    case "continue":
      return t.continueStatement()
    case "if":
      return ifToBabel(statement.clauses, statement.else, 0)
    case "while":
      return t.whileStatement(exprToBabel(statement.condition), blockToBabel(statement.body))
    case "for-of":
      return t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(ident(statement.name, "for-of"))]),
        exprToBabel(statement.iterable),
        blockToBabel(statement.body),
      )
    default:
      return assertNever(statement)
  }
}
