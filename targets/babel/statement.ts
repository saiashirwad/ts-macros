import * as t from "@babel/types"

import type { BindingDeclaration } from "../../src/binding.ts"
import type { Emit, StatementHandlers } from "../../src/emit/target.ts"
import type * as Fn from "../../src/function.ts"
import type { Block, IfClause } from "../../src/statement.ts"
import type * as Type from "../../src/types/index.ts"
import { ident } from "./shared.ts"

type BabelEmit = Emit<t.Expression, t.Statement, t.TSType>

export const blockToBabel = (emit: BabelEmit, block: Block): t.BlockStatement => t.blockStatement(emit.block(block))

export const paramToBabel = (emit: BabelEmit, param: Fn.AnyParam): t.Identifier | t.RestElement => {
  const name = emit.bindingName(param.id, param.nameHint)
  const id = ident(name, `param "${param.nameHint}"`)
  const annotation = t.tsTypeAnnotation(emit.type(param.type))
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

const typeParamsToBabel = (emit: BabelEmit, typeParams: Type.AnyParams): t.TSTypeParameterDeclaration | null =>
  typeParams.length === 0
    ? null
    : t.tsTypeParameterDeclaration(
      typeParams.map((param) => t.tsTypeParameter(param.extends === undefined ? null : emit.type(param.extends), null, param.name)),
    )

const ifToBabel = (
  emit: BabelEmit,
  clauses: ReadonlyArray<IfClause>,
  elseBlock: Block | null,
  index: number,
): t.IfStatement => {
  const clause = clauses[index]!
  return t.ifStatement(
    emit.expr(clause.condition),
    blockToBabel(emit, clause.body),
    index + 1 < clauses.length
      ? ifToBabel(emit, clauses, elseBlock, index + 1)
      : elseBlock === null
      ? null
      : blockToBabel(emit, elseBlock),
  )
}

const bindingDeclaration = (node: BindingDeclaration, emit: BabelEmit): t.VariableDeclaration => {
  const name = emit.bindingName(node.id, node.nameHint)
  const id = ident(name, node.tag)
  if (node.annotation !== undefined) id.typeAnnotation = t.tsTypeAnnotation(emit.type(node.annotation))
  return t.variableDeclaration(node.tag === "let-declaration" ? "let" : "const", [
    t.variableDeclarator(id, node.expr === undefined ? null : emit.expr(node.expr)),
  ])
}

export const babelStatements: StatementHandlers<t.Expression, t.Statement, t.TSType> = {
  "let-declaration": bindingDeclaration,
  "const-declaration": bindingDeclaration,
  "function-declaration": (node, emit) => {
    if (node.body === undefined) {
      throw new Error(`Cannot emit function ${node.nameHint} without an implementation`)
    }
    const name = emit.bindingName(node.id, node.nameHint)
    const declaration = t.functionDeclaration(
      ident(name, "function-declaration"),
      node.params.map((param: Fn.AnyParam) => paramToBabel(emit, param)),
      blockToBabel(emit, node.body),
    )
    declaration.typeParameters = typeParamsToBabel(emit, node.typeParams)
    declaration.returnType = node.returnType === undefined ? null : t.tsTypeAnnotation(emit.type(node.returnType))
    return declaration
  },
  "type-declaration": (node, emit) => {
    if (node.body === undefined) {
      throw new Error(`Cannot emit type ${node.name} without a body`)
    }
    return t.tsTypeAliasDeclaration(
      ident(node.name, "type-declaration"),
      typeParamsToBabel(emit, node.params),
      emit.type(node.body),
    )
  },
  return: (node, emit) => t.returnStatement(emit.expr(node.value)),
  throw: (node, emit) => t.throwStatement(emit.expr(node.value)),
  "expr-statement": (node, emit) => t.expressionStatement(emit.expr(node.expr)),
  assign: (node, emit) => t.expressionStatement(emit.expr(node)),
  break: () => t.breakStatement(),
  continue: () => t.continueStatement(),
  if: (node, emit) => ifToBabel(emit, node.clauses, node.else, 0),
  while: (node, emit) => t.whileStatement(emit.expr(node.condition), blockToBabel(emit, node.body)),
  "for-of": (node, emit) => {
    const name = emit.bindingName(node.id, node.nameHint)
    return t.forOfStatement(
      t.variableDeclaration("const", [t.variableDeclarator(ident(name, "for-of"))]),
      emit.expr(node.iterable),
      blockToBabel(emit, node.body),
    )
  },
}
