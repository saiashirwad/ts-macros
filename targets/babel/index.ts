import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type { BindingDeclaration } from "../../src/binding.ts"
import { collectImports } from "../../src/emit/imports.ts"
import { type Emit, makeEmit, type Target } from "../../src/emit/target.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import type { Program } from "../../src/program.ts"
import { bindingNames } from "../../src/scope.ts"
import type { Block, IfClause } from "../../src/statement.ts"
import type * as Type from "../../src/types/index.ts"

type BabelEmit = Emit<t.Expression, t.Statement, t.TSType>

const ident = (name: string, context: string): t.Identifier => {
  if (!t.isValidIdentifier(name)) {
    throw new Error(`Cannot emit invalid identifier "${name}" (in ${context})`)
  }
  return t.identifier(name)
}

const assertNever = (x: never): never => {
  throw new Error(`cannot emit "${(x as { readonly tag: string }).tag}"`)
}

const blockStatement = (emit: BabelEmit, block: Block): t.BlockStatement => t.blockStatement(emit.block(block))

const param = (emit: BabelEmit, node: Fn.AnyParam): t.Identifier | t.RestElement => {
  const id = ident(emit.bindingName(node.id, node.nameHint), `param "${node.nameHint}"`)
  const annotation = t.tsTypeAnnotation(emit.type(node.type))
  switch (node.kind) {
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

const typeParams = (emit: BabelEmit, params: Type.AnyParams): t.TSTypeParameterDeclaration | null =>
  params.length === 0
    ? null
    : t.tsTypeParameterDeclaration(params.map((p) => t.tsTypeParameter(p.extends === undefined ? null : emit.type(p.extends), null, p.name)))

const ifChain = (emit: BabelEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null, index = 0): t.IfStatement => {
  const clause = clauses[index]!
  return t.ifStatement(
    emit.expr(clause.condition),
    blockStatement(emit, clause.body),
    index + 1 < clauses.length ? ifChain(emit, clauses, elseBlock, index + 1) : elseBlock === null ? null : blockStatement(emit, elseBlock),
  )
}

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
    object: (node, emit) =>
      t.objectExpression(Object.entries(node.fields).map(([key, value]) => t.objectProperty(ident(key, "object field"), emit.expr(value)))),
    "call-expr": (node, emit) => t.callExpression(emit.expr(node.callee), node.args.map((argument) => emit.expr(argument))),
    instantiation: (node, emit) =>
      t.tsInstantiationExpression(emit.expr(node.callee), t.tsTypeParameterInstantiation(node.typeArgs.map((argument) => emit.type(argument)))),
    arrow: (node, emit) => t.arrowFunctionExpression(node.params.map((p) => param(emit, p)), blockStatement(emit, node.body)),
    binary: (node, emit) => {
      const left = emit.expr(node.left)
      const right = emit.expr(node.right)
      return node.op === "&&" || node.op === "||" ? t.logicalExpression(node.op, left, right) : t.binaryExpression(node.op, left, right)
    },
    unary: (node, emit) => t.unaryExpression(node.op, emit.expr(node.operand)),
    template: (node, emit) => {
      if (node.parts.length !== node.exprs.length + 1) {
        throw new Error(
          `cannot emit a template with ${node.parts.length} parts and ${node.exprs.length} exprs (expected ${node.exprs.length + 1} parts)`,
        )
      }
      return t.templateLiteral(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map((part) => emit.expr(part)),
      )
    },
    cond: (node, emit) => t.conditionalExpression(emit.expr(node.condition), emit.expr(node.then), emit.expr(node.else)),
    assign: (node, emit) => t.assignmentExpression("=", emit.expr(node.target) as t.LVal, emit.expr(node.value)),
  },
  statement: {
    "let-declaration": bindingDeclaration,
    "const-declaration": bindingDeclaration,
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit function ${node.nameHint} without an implementation`)
      }
      const declaration = t.functionDeclaration(
        ident(emit.bindingName(node.id, node.nameHint), "function-declaration"),
        node.params.map((p: Fn.AnyParam) => param(emit, p)),
        blockStatement(emit, node.body),
      )
      declaration.typeParameters = typeParams(emit, node.typeParams)
      declaration.returnType = node.returnType === undefined ? null : t.tsTypeAnnotation(emit.type(node.returnType))
      return declaration
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      return t.tsTypeAliasDeclaration(ident(node.name, "type-declaration"), typeParams(emit, node.params), emit.type(node.body))
    },
    return: (node, emit) => t.returnStatement(emit.expr(node.value)),
    throw: (node, emit) => t.throwStatement(emit.expr(node.value)),
    "expr-statement": (node, emit) => t.expressionStatement(emit.expr(node.expr)),
    assign: (node, emit) => t.expressionStatement(emit.expr(node)),
    break: () => t.breakStatement(),
    continue: () => t.continueStatement(),
    if: (node, emit) => ifChain(emit, node.clauses, node.else),
    while: (node, emit) => t.whileStatement(emit.expr(node.condition), blockStatement(emit, node.body)),
    "for-of": (node, emit) =>
      t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(ident(emit.bindingName(node.id, node.nameHint), "for-of"))]),
        emit.expr(node.iterable),
        blockStatement(emit, node.body),
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
    param: (node) => t.tsTypeReference(ident(node.name, "type param")),
    object: (node, emit) =>
      t.tsTypeLiteral(
        Object.entries(node.fields).map(([key, value]) =>
          t.tsPropertySignature(ident(key, "object type field"), t.tsTypeAnnotation(emit.type(value)))
        ),
      ),
    union: (node, emit) => t.tsUnionType(node.members.map((member: Type.TypeExpr<any>) => emit.type(member))),
    array: (node, emit) => t.tsArrayType(emit.type(node.element)),
    tuple: (node, emit) => t.tsTupleType(node.items.map((item) => emit.type(item))),
    function: (node, emit) =>
      t.tsFunctionType(
        null,
        node.params.map((p, index) => {
          const argument = ident(`arg${index}`, "function type param")
          argument.typeAnnotation = t.tsTypeAnnotation(emit.type(p))
          return argument
        }),
        t.tsTypeAnnotation(emit.type(node.return)),
      ),
    // a nominal type is spelled by what it erases to; this target does not know the name
    "type-ref": (node, emit) =>
      node.erasesTo !== undefined
        ? emit.type(node.erasesTo)
        : t.tsTypeReference(
          ident(node.name, "type-ref"),
          node.args !== undefined && node.args.length > 0 ? t.tsTypeParameterInstantiation(node.args.map((argument) => emit.type(argument))) : null,
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
