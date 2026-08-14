import * as t from "@babel/types"

import type { BindingDeclaration } from "../binding.ts"
import type * as Fn from "../function.ts"
import type { Block, IfClause } from "../statement.ts"
import type * as Type from "../types/index.ts"
import { type Emit, makeEmit, type Target } from "./target.ts"

type TsEmit = Emit<t.Expression, t.Statement, t.TSType>

export const ident = (name: string, context: string): t.Identifier => {
  if (!t.isValidIdentifier(name)) {
    throw new Error(`Cannot emit invalid identifier "${name}" (in ${context})`)
  }
  return t.identifier(name)
}

const param = (emit: TsEmit, node: Fn.AnyParam): t.Identifier | t.RestElement => {
  const id = ident(node.name, `param "${node.name}"`)
  const annotation = t.tsTypeAnnotation(emit.type(node.type))
  switch (node.kind) {
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

const typeParams = (emit: TsEmit, params: Type.AnyParams): t.TSTypeParameterDeclaration | null =>
  params.length === 0
    ? null
    : t.tsTypeParameterDeclaration(
      params.map((p) => t.tsTypeParameter(p.extends === undefined ? null : emit.type(p.extends), null, p.name)),
    )

const ifChain = (emit: TsEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null, index: number): t.IfStatement => {
  const clause = clauses[index]!
  return t.ifStatement(
    emit.expr(clause.condition),
    t.blockStatement(emit.block(clause.body)),
    index + 1 < clauses.length
      ? ifChain(emit, clauses, elseBlock, index + 1)
      : elseBlock === null
      ? null
      : t.blockStatement(emit.block(elseBlock)),
  )
}

const primitives: { readonly [Name in Type.PrimitiveName]: () => t.TSType } = {
  string: t.tsStringKeyword,
  number: t.tsNumberKeyword,
  boolean: t.tsBooleanKeyword,
  undefined: t.tsUndefinedKeyword,
  null: t.tsNullKeyword,
  void: t.tsVoidKeyword,
  never: t.tsNeverKeyword,
  unknown: t.tsUnknownKeyword,
  any: t.tsAnyKeyword,
}

const needsArrayParens = (element: Type.Any): boolean =>
  element.tag === "infer-var" || element.tag === "union" || element.tag === "intersection" || element.tag === "function"
  || element.tag === "conditional"

const field = (emit: TsEmit, key: string, value: Type.TypeExpr<any>): t.TSPropertySignature => {
  let readonly = false
  let optional = false
  let current = value as Type.Any
  while (current.tag === "readonly-field" || current.tag === "optional-field") {
    if (current.tag === "readonly-field") readonly = true
    if (current.tag === "optional-field") optional = true
    current = current.field as Type.Any
  }
  const signature = t.tsPropertySignature(ident(key, "object type field"), t.tsTypeAnnotation(emit.type(current)))
  if (readonly) signature.readonly = true
  if (optional) signature.optional = true
  return signature
}

export const typescript: Target<t.Expression, t.Statement, t.TSType> = {
  expr: {
    literal: (node) =>
      typeof node.value === "string"
        ? t.stringLiteral(node.value)
        : typeof node.value === "number"
        ? t.numericLiteral(node.value)
        : t.booleanLiteral(node.value),
    "var-ref": (node) => ident(node.name, node.tag),
    prop: (node, emit) => t.memberExpression(emit.expr(node.object), ident(node.key, "prop key")),
    index: (node, emit) => t.memberExpression(emit.expr(node.object), emit.expr(node.index), true),
    array: (node, emit) => t.arrayExpression(node.elements.map(emit.expr)),
    // Object.entries reorders integer keys; __proto__ is lost
    object: (node, emit) =>
      t.objectExpression(
        Object.entries(node.fields).map(([key, value]) => t.objectProperty(ident(key, "object field"), emit.expr(value))),
      ),
    "call-expr": (node, emit) => t.callExpression(emit.expr(node.callee), node.args.map(emit.expr)),
    instantiation: (node, emit) =>
      t.tsInstantiationExpression(
        emit.expr(node.callee),
        t.tsTypeParameterInstantiation(node.typeArgs.map(emit.type)),
      ),
    arrow: (node, emit) => t.arrowFunctionExpression(node.params.map((p) => param(emit, p)), t.blockStatement(emit.block(node.body))),
    binary: (node, emit) => {
      const left = emit.expr(node.left)
      const right = emit.expr(node.right)
      return node.op === "&&" || node.op === "||"
        ? t.logicalExpression(node.op, left, right)
        : t.binaryExpression(node.op, left, right)
    },
    unary: (node, emit) => t.unaryExpression(node.op, emit.expr(node.operand)),
    template: (node, emit) =>
      t.templateLiteral(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map(emit.expr),
      ),
    cond: (node, emit) => t.conditionalExpression(emit.expr(node.condition), emit.expr(node.then), emit.expr(node.else)),
    assign: (node, emit) => t.assignmentExpression("=", emit.expr(node.target) as t.LVal, emit.expr(node.value)),
  },
  statement: {
    binding: (node, emit) => bindingDeclaration(node, emit),
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit function ${node.name} without an implementation`)
      }
      const declaration = t.functionDeclaration(
        ident(node.name, "function-declaration"),
        node.params.map((p: Fn.AnyParam) => param(emit, p)),
        t.blockStatement(emit.block(node.body)),
      )
      declaration.typeParameters = typeParams(emit, node.typeParams)
      declaration.returnType = node.returnType === undefined ? null : t.tsTypeAnnotation(emit.type(node.returnType))
      return declaration
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      return t.tsTypeAliasDeclaration(
        ident(node.name, "type-declaration"),
        typeParams(emit, node.params),
        emit.type(node.body),
      )
    },
    return: (node, emit) => t.returnStatement(emit.expr(node.value)),
    throw: (node, emit) => t.throwStatement(emit.expr(node.value)),
    "expr-statement": (node, emit) => t.expressionStatement(emit.expr(node.expr)),
    assign: (node, emit) => t.expressionStatement(emit.expr(node)),
    break: () => t.breakStatement(),
    continue: () => t.continueStatement(),
    if: (node, emit) => ifChain(emit, node.clauses, node.else, 0),
    while: (node, emit) => t.whileStatement(emit.expr(node.condition), t.blockStatement(emit.block(node.body))),
    "for-of": (node, emit) =>
      t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(ident(node.name, "for-of"))]),
        emit.expr(node.iterable),
        t.blockStatement(emit.block(node.body)),
      ),
  },
  type: {
    primitive: (node) => primitives[node.name](),
    literal: (node) =>
      node.value === null
        ? t.tsNullKeyword()
        : t.tsLiteralType(
          typeof node.value === "string"
            ? t.stringLiteral(node.value)
            : typeof node.value === "number"
            ? t.numericLiteral(node.value)
            : t.booleanLiteral(node.value),
        ),
    object: (node, emit) => t.tsTypeLiteral(Object.entries(node.fields).map(([key, value]) => field(emit, key, value))),
    union: (node, emit) => t.tsUnionType(node.members.map(emit.type)),
    intersection: (node, emit) => t.tsIntersectionType(node.members.map(emit.type)),
    "indexed-access": (node, emit) => t.tsIndexedAccessType(emit.type(node.object), emit.type(node.key)),
    keyof: (node, emit) => t.tsTypeOperator(emit.type(node.operand), "keyof"),
    conditional: (node, emit) =>
      t.tsConditionalType(
        emit.type(node.check),
        emit.type(node.extends),
        emit.type(node.then),
        emit.type(node.else),
      ),
    mapped: (node, emit) =>
      t.tsMappedType(
        t.tsTypeParameter(t.tsTypeOperator(emit.type(node.source), "keyof"), null, node.key),
        emit.type(node.body),
      ),
    "template-literal": (node, emit) =>
      t.tsTemplateLiteralType(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map(emit.type),
      ),
    "infer-var": (node) => t.tsInferType(t.tsTypeParameter(null, null, node.name)),
    "readonly-field": (node) => {
      throw new Error(`"${node.tag}" is a field modifier and only valid inside object types`)
    },
    "optional-field": (node) => {
      throw new Error(`"${node.tag}" is a field modifier and only valid inside object types`)
    },
    array: (node, emit) => {
      const element = emit.type(node.element)
      return t.tsArrayType(needsArrayParens(node.element as Type.Any) ? t.tsParenthesizedType(element) : element)
    },
    tuple: (node, emit) => t.tsTupleType(node.items.map(emit.type)),
    function: (node, emit) => {
      const params: (t.Identifier | t.RestElement)[] = node.params.map((p, index) => {
        const arg = ident(`arg${index}`, "function type param")
        arg.typeAnnotation = t.tsTypeAnnotation(emit.type(p))
        return arg
      })
      if (node.rest !== undefined) {
        const rest = t.restElement(ident(`arg${node.params.length}`, "function type rest param"))
        rest.typeAnnotation = t.tsTypeAnnotation(emit.type(node.rest))
        params.push(rest)
      }
      return t.tsFunctionType(null, params, t.tsTypeAnnotation(emit.type(node.return)))
    },
    "type-ref": (node, emit) =>
      t.tsTypeReference(
        ident(node.name, "type-ref"),
        node.args !== undefined && node.args.length > 0
          ? t.tsTypeParameterInstantiation(node.args.map(emit.type))
          : null,
      ),
    application: (node, emit) => {
      const callee = node.callee as Type.Any
      if (callee.tag !== "type-ref") {
        throw new Error(`cannot emit a type application whose callee is "${callee.tag}" (expected "type-ref")`)
      }
      return t.tsTypeReference(
        ident(callee.name, "type application"),
        t.tsTypeParameterInstantiation(node.args.map(emit.type)),
      )
    },
    param: (node) => t.tsTypeReference(ident(node.name, "type param")),
  },
}

const bindingDeclaration = (node: BindingDeclaration, emit: TsEmit): t.Statement => {
  const id = ident(node.name, node.tag)
  if (node.annotation !== undefined) {
    id.typeAnnotation = t.tsTypeAnnotation(emit.type(node.annotation))
  }
  return t.variableDeclaration(node.kind, [
    t.variableDeclarator(id, node.expr === undefined ? null : emit.expr(node.expr)),
  ])
}

const emit: TsEmit = makeEmit(typescript)

export const exprToBabel = emit.expr

export const statementToBabel = emit.statement

export const typeExprToBabel = emit.type

export const blockToBabel = (block: Block): t.BlockStatement => t.blockStatement(emit.block(block))
