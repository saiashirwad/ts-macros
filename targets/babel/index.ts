import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type { BindingDeclaration } from "../../src/binding.ts"
import { collectImports } from "../../src/emit/imports.ts"
import { type Emit, makeEmit, type Target } from "../../src/emit/target.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import type { ValueReference } from "../../src/identity.ts"
import type { Program } from "../../src/program.ts"
import { bindingNames } from "../../src/scope.ts"
import type { Block, IfStatement } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"
import { identifier, misplacedFieldModifier, propertyName, templateRaw, unwrapField } from "../ecmascript.ts"

type BabelEmit = Emit<t.Expression, t.Statement, t.TSType>

// helpers take `(node, emit)`, like the handlers that call them

const ident = (name: string, context: string): t.Identifier => t.identifier(identifier(name, context))

const propertyKey = (name: string, context: string): t.Identifier => t.identifier(propertyName(name, context))

const templateElement = (part: string): t.TemplateElement => t.templateElement({ raw: templateRaw(part), cooked: part })

/** babel's numeric literal is unsigned; a negative one printed bare turns `(-1).toFixed()` into `-(1).toFixed()` */
const numericLiteral = (value: number): t.Expression =>
  value < 0 || Object.is(value, -0) ? t.unaryExpression("-", t.numericLiteral(-value)) : t.numericLiteral(value)

const assertNever = (x: never): never => {
  throw new Error(`cannot emit ${JSON.stringify(x)}`)
}

const reference = (node: ValueReference & { readonly tag: string }, emit: BabelEmit): t.Identifier =>
  ident(emit.bindingName(node.target, node.nameHint), node.tag)

const blockStatement = (block: Block, emit: BabelEmit): t.BlockStatement => t.blockStatement(emit.block(block))

const param = (node: Fn.AnyParam, emit: BabelEmit): t.Identifier | t.RestElement => {
  const id = ident(emit.bindingName(node.id, node.nameHint), `param "${node.nameHint}"`)
  switch (node.kind) {
    case "required":
      id.typeAnnotation = t.tsTypeAnnotation(emit.type(node.type))
      return id
    case "optional":
      id.optional = true
      id.typeAnnotation = t.tsTypeAnnotation(emit.type(node.type))
      return id
    // babel prints a rest param's annotation off the RestElement
    case "rest": {
      const rest = t.restElement(id)
      rest.typeAnnotation = t.tsTypeAnnotation(emit.type(Type.Array(node.type)))
      return rest
    }
  }
}

const typeParams = (params: Type.AnyParams, emit: BabelEmit): t.TSTypeParameterDeclaration | null =>
  params.length === 0
    ? null
    : t.tsTypeParameterDeclaration(
      params.map((p) => t.tsTypeParameter(p.extends === undefined ? null : emit.type(p.extends), null, identifier(p.name, "type param"))),
    )

const ifChain = (node: IfStatement, emit: BabelEmit, index = 0): t.IfStatement => {
  const clause = node.clauses[index]!
  return t.ifStatement(
    emit.expr(clause.condition),
    blockStatement(clause.body, emit),
    index + 1 < node.clauses.length ? ifChain(node, emit, index + 1) : node.else === undefined ? null : blockStatement(node.else, emit),
  )
}

const field = (key: string, value: Type.TypeExpr<any>, emit: BabelEmit): t.TSPropertySignature => {
  const { readonly, optional, type } = unwrapField(value)
  const signature = t.tsPropertySignature(propertyKey(key, "object type field"), t.tsTypeAnnotation(emit.type(type)))
  if (readonly) signature.readonly = true
  if (optional) signature.optional = true
  return signature
}

const needsArrayParens = (element: Type.Any): boolean =>
  element.tag === "infer-var" || element.tag === "union" || element.tag === "intersection" || element.tag === "function"
  || element.tag === "conditional"

const bindingDeclaration = (node: BindingDeclaration, emit: BabelEmit): t.VariableDeclaration => {
  const id = ident(emit.bindingName(node.id, node.nameHint), node.tag)
  if (node.annotation !== undefined) id.typeAnnotation = t.tsTypeAnnotation(emit.type(node.annotation))
  return t.variableDeclaration(node.tag === "let-declaration" ? "let" : "const", [
    t.variableDeclarator(id, node.expr === undefined ? null : emit.expr(node.expr)),
  ])
}

const primitive = (name: Type.PrimitiveName): t.TSType => {
  switch (name) {
    case "string":
      return t.tsStringKeyword()
    case "number":
      return t.tsNumberKeyword()
    case "boolean":
      return t.tsBooleanKeyword()
    case "undefined":
      return t.tsUndefinedKeyword()
    case "null":
      return t.tsNullKeyword()
    case "void":
      return t.tsVoidKeyword()
    case "never":
      return t.tsNeverKeyword()
    case "unknown":
      return t.tsUnknownKeyword()
    case "any":
      return t.tsAnyKeyword()
    default:
      return assertNever(name)
  }
}

export const babel: Target<t.Expression, t.Statement, t.TSType> = {
  expr: {
    literal: (node) =>
      typeof node.value === "string"
        ? t.stringLiteral(node.value)
        : typeof node.value === "number"
        ? numericLiteral(node.value)
        : typeof node.value === "boolean"
        ? t.booleanLiteral(node.value)
        : assertNever(node.value),
    "external-ref": (node) => ident(node.name, node.tag),
    "var-ref": reference,
    "function-ref": reference,
    "generic-function-ref": reference,
    prop: (node, emit) => t.memberExpression(emit.expr(node.object), propertyKey(node.key, "prop key")),
    index: (node, emit) => t.memberExpression(emit.expr(node.object), emit.expr(node.index), true),
    array: (node, emit) => t.arrayExpression(node.elements.map((element: Expr.Expr<any>) => emit.expr(element))),
    object: (node, emit) =>
      t.objectExpression(Object.entries(node.fields).map(([key, value]) => t.objectProperty(propertyKey(key, "object field"), emit.expr(value)))),
    "call-expr": (node, emit) => t.callExpression(emit.expr(node.callee), node.args.map((argument) => emit.expr(argument))),
    instantiation: (node, emit) =>
      t.tsInstantiationExpression(emit.expr(node.callee), t.tsTypeParameterInstantiation(node.typeArgs.map((argument) => emit.type(argument)))),
    arrow: (node, emit) => t.arrowFunctionExpression(node.params.map((p) => param(p, emit)), blockStatement(node.body, emit)),
    binary: (node, emit) => {
      const left = emit.expr(node.left)
      const right = emit.expr(node.right)
      return node.op === "&&" || node.op === "||" ? t.logicalExpression(node.op, left, right) : t.binaryExpression(node.op, left, right)
    },
    unary: (node, emit) => t.unaryExpression(node.op, emit.expr(node.operand)),
    template: (node, emit) => t.templateLiteral(node.parts.map(templateElement), node.exprs.map((part) => emit.expr(part))),
    cond: (node, emit) => t.conditionalExpression(emit.expr(node.condition), emit.expr(node.then), emit.expr(node.else)),
    assign: (node, emit) => t.assignmentExpression("=", emit.expr(node.target) as t.LVal, emit.expr(node.value)),
  },
  statement: {
    "let-declaration": bindingDeclaration,
    "const-declaration": bindingDeclaration,
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`cannot emit function "${node.nameHint}" without an implementation`)
      }
      const declaration = t.functionDeclaration(
        ident(emit.bindingName(node.id, node.nameHint), node.tag),
        node.params.map((p: Fn.AnyParam) => param(p, emit)),
        blockStatement(node.body, emit),
      )
      declaration.typeParameters = typeParams(node.typeParams, emit)
      declaration.returnType = node.returnType === undefined ? null : t.tsTypeAnnotation(emit.type(node.returnType))
      return declaration
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`cannot emit type "${node.name}" without a body`)
      }
      return t.tsTypeAliasDeclaration(ident(node.name, node.tag), typeParams(node.params, emit), emit.type(node.body))
    },
    return: (node, emit) => t.returnStatement(emit.expr(node.value)),
    throw: (node, emit) => t.throwStatement(emit.expr(node.value)),
    "expr-statement": (node, emit) => t.expressionStatement(emit.expr(node.expr)),
    assign: (node, emit) => t.expressionStatement(emit.expr(node)),
    break: () => t.breakStatement(),
    continue: () => t.continueStatement(),
    if: (node, emit) => ifChain(node, emit),
    while: (node, emit) => t.whileStatement(emit.expr(node.condition), blockStatement(node.body, emit)),
    "for-of": (node, emit) =>
      t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(ident(emit.bindingName(node.id, node.nameHint), node.tag))]),
        emit.expr(node.iterable),
        blockStatement(node.body, emit),
      ),
  },
  type: {
    primitive: (node) => primitive(node.name),
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
    "template-literal": (node, emit) => t.tsTemplateLiteralType(node.parts.map(templateElement), node.exprs.map((e) => emit.type(e))),
    param: (node) => t.tsTypeReference(ident(node.name, "type param")),
    "infer-var": (node) => t.tsInferType(t.tsTypeParameter(null, null, identifier(node.name, node.tag))),
    object: (node, emit) => t.tsTypeLiteral(Object.entries(node.fields).map(([key, value]) => field(key, value, emit))),
    "readonly-field": misplacedFieldModifier,
    "optional-field": misplacedFieldModifier,
    union: (node, emit) => t.tsUnionType(node.members.map((member: Type.TypeExpr<any>) => emit.type(member))),
    intersection: (node, emit) => t.tsIntersectionType(node.members.map((member: Type.TypeExpr<any>) => emit.type(member))),
    array: (node, emit) => {
      const element = emit.type(node.element)
      return t.tsArrayType(needsArrayParens(node.element as Type.Any) ? t.tsParenthesizedType(element) : element)
    },
    tuple: (node, emit) => t.tsTupleType(node.items.map((item) => emit.type(item))),
    function: (node, emit) => {
      const params: (t.Identifier | t.RestElement)[] = node.params.map((p, index) => {
        const argument = ident(`arg${index}`, "function type param")
        argument.typeAnnotation = t.tsTypeAnnotation(emit.type(p))
        return argument
      })
      if (node.rest !== undefined) {
        const rest = t.restElement(ident(`arg${node.params.length}`, "function type rest param"))
        rest.typeAnnotation = t.tsTypeAnnotation(emit.type(node.rest))
        params.push(rest)
      }
      return t.tsFunctionType(null, params, t.tsTypeAnnotation(emit.type(node.return)))
    },
    "indexed-access": (node, emit) => t.tsIndexedAccessType(emit.type(node.object), emit.type(node.key)),
    keyof: (node, emit) => t.tsTypeOperator(emit.type(node.operand), "keyof"),
    conditional: (node, emit) => t.tsConditionalType(emit.type(node.check), emit.type(node.extends), emit.type(node.then), emit.type(node.else)),
    mapped: (node, emit) =>
      t.tsMappedType(
        t.tsTypeParameter(t.tsTypeOperator(emit.type(node.source), "keyof"), null, identifier(node.key, "mapped type key")),
        emit.type(node.body),
      ),
    // a nominal type is spelled by what it erases to; this target does not know the name
    "type-ref": (node, emit) =>
      node.erasesTo !== undefined
        ? emit.type(node.erasesTo)
        : t.tsTypeReference(
          ident(node.name, node.tag),
          node.args.length > 0 ? t.tsTypeParameterInstantiation(node.args.map((argument) => emit.type(argument))) : null,
        ),
  },
}

export const programToBabel = (program: Program<unknown>): t.Program => {
  const emit = makeEmit(babel, bindingNames(program.statements))
  return t.program(
    [
      ...collectImports(program.statements).map((binding) =>
        t.importDeclaration([t.importNamespaceSpecifier(ident(binding.local, `import from "${binding.source}"`))], t.stringLiteral(binding.source))
      ),
      ...program.statements.map(emit.statement),
    ],
    [],
    "module",
  )
}

export const emitProgram = (program: Program<unknown>): string => generate(programToBabel(program)).code
