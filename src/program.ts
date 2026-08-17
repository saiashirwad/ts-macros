import * as Binding from "./binding.ts"
import { widen } from "./emit/type-ir.ts"
import * as Expr from "./expr.ts"
import { paramBindings } from "./function.ts"
import type * as Fn from "./function.ts"
import type { BindingId } from "./identity.ts"
import { makePipeable, makeYieldable } from "./pipeable.ts"
import { validateScopes } from "./scope/validate.ts"
import { type Block, collectReturns, mapChildStatements, materializeValue, type Statement } from "./statement.ts"
import type * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"
import { walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

const inferredReturnType = (body: Block): Type.TypeExpr<any> | undefined => {
  const returns = collectReturns(body)
  if (returns.length === 0) return Type.Void()
  const types = returns.map((value) => value.type).filter((type): type is Type.TypeExpr<any> => type !== undefined)
  return types.length === 0 ? undefined : widen(types[types.length - 1]!)
}

const materializeStatements = (statements: ReadonlyArray<Statement>): Statement[] => statements.map(materializeStatement)

const materializeFunction = (decl: Fn.FunctionDeclaration<any, any, any>): Fn.FunctionDeclaration<any, any, any> => {
  if (decl.impl === undefined) {
    return decl.body === undefined
      ? decl
      : makePipeable({ ...decl, body: { ...decl.body, statements: materializeStatements(decl.body.statements) } })
  }

  const body = materializeValue(() => decl.impl!(paramBindings(decl.params)))
  const materializedBody = makePipeable({ ...body, statements: materializeStatements(body.statements) })
  const returnType = decl.returnType ?? inferredReturnType(materializedBody)
  const type = returnType === undefined ? decl.type : Type.Function(decl.params.map((param: Fn.AnyParam) => param.type), returnType)
  const { impl: _impl, ...withoutImpl } = decl
  return makePipeable({ ...withoutImpl, body: materializedBody, returnType, type }) as Fn.FunctionDeclaration<any, any, any>
}

const materializeStatement = (statement: Statement): Statement => {
  if (statement.tag === "function-declaration") return materializeFunction(statement)
  return mapChildStatements(statement, (statements) => materializeStatements(statements))
}

const materialize = (statements: ReadonlyArray<Statement>): Statement[] => materializeStatements(statements)

const annotateKnownTypes = (statements: ReadonlyArray<Statement>): Statement[] => {
  const functions = new Map<BindingId, Fn.FunctionDeclaration<any, any, any>>()
  walk(statements, (node) => {
    if (node.tag === "function-declaration") {
      const declaration = node as unknown as Fn.FunctionDeclaration<any, any, any>
      functions.set(declaration.id, declaration)
    }
  })

  const annotateExpr = (expr: Expr.Expr<any>): Expr.Expr<any> => {
    const node = expr as Expr.Any | Fn.Any
    switch (node.tag) {
      case "function-ref":
      case "generic-function-ref": {
        const declaration = functions.get(node.target)
        const type = node.type ?? declaration?.type
        return type === undefined ? expr : makePipeable({ ...node, type })
      }
      case "call-expr": {
        const callee = annotateExpr(node.callee)
        const args = node.args.map(annotateExpr)
        const calleeType = callee.type as Type.FunctionType | undefined
        const type = node.type ?? (calleeType?.tag === "function" ? calleeType.return : undefined)
        return makePipeable({ ...node, callee, args, type })
      }
      case "prop":
        return makePipeable({ ...node, object: annotateExpr(node.object) })
      case "index":
        return makePipeable({ ...node, object: annotateExpr(node.object), index: annotateExpr(node.index) })
      case "object":
        return makePipeable({ ...node, fields: Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, annotateExpr(value)])) })
      case "array":
        return makePipeable({ ...node, elements: node.elements.map(annotateExpr) })
      case "binary":
        return makePipeable({ ...node, left: annotateExpr(node.left), right: annotateExpr(node.right) })
      case "unary":
        return makePipeable({ ...node, operand: annotateExpr(node.operand) })
      case "template":
        return makePipeable({ ...node, exprs: node.exprs.map(annotateExpr) })
      case "assign":
        return makeYieldable({ ...node, target: annotateExpr(node.target) as Expr.LValue, value: annotateExpr(node.value) })
      case "cond":
        return makePipeable({
          ...node,
          condition: annotateExpr(node.condition),
          then: annotateExpr(node.then),
          else: annotateExpr(node.else),
        })
      case "instantiation":
        return makePipeable({ ...node, callee: annotateExpr(node.callee) })
      case "arrow":
        return makePipeable({ ...node, body: annotateBlock(node.body) })
      default:
        return expr
    }
  }

  const annotateBlock = (block: Block): Block => makePipeable({ ...block, statements: annotateStatements(block.statements) })

  const annotateStatements = (list: ReadonlyArray<Statement>): Statement[] =>
    list.map((statement) => {
      switch (statement.tag) {
        case "function-declaration":
          return makePipeable({ ...statement, body: statement.body === undefined ? undefined : annotateBlock(statement.body) })
        case "let-declaration":
        case "const-declaration":
          return makePipeable({ ...statement, expr: statement.expr === undefined ? undefined : annotateExpr(statement.expr) })
        case "return":
        case "throw":
          return makeYieldable({ ...statement, value: annotateExpr(statement.value) })
        case "expr-statement":
          return makeYieldable({ ...statement, expr: annotateExpr(statement.expr) })
        case "assign":
          return annotateExpr(statement) as Expr.Assign<any, any>
        case "if":
          return makePipeable({
            ...statement,
            clauses: statement.clauses.map((clause) => ({ ...clause, condition: annotateExpr(clause.condition), body: annotateBlock(clause.body) })),
            else: statement.else === null ? null : annotateBlock(statement.else),
          })
        case "while":
          return makePipeable({ ...statement, condition: annotateExpr(statement.condition), body: annotateBlock(statement.body) })
        case "for-of":
          return makePipeable({ ...statement, iterable: annotateExpr(statement.iterable), body: annotateBlock(statement.body) })
        default:
          return statement
      }
    })

  return annotateStatements(statements)
}

type StatementListItem =
  | Binding.BindingDeclaration
  | Fn.FunctionDeclaration<any, any, any>
  | Type.TypeDeclaration<any, any>
  | Stmt.ThrowStatement
  | Stmt.ExprStatement
  | Stmt.IfStatement
  | Stmt.WhileStatement
  | Stmt.ForOfStatement
  | Expr.Assign<any, any>

export function build<A>(
  body: () => Generator<StatementListItem, A, unknown>,
): Program<A> {
  const iterator = body()
  const statements: Statement[] = []
  while (true) {
    const { value, done } = iterator.next()
    if (done) {
      const materialized = annotateKnownTypes(materialize(statements))
      validateScopes(materialized)
      return { statements: materialized, result: value }
    }
    statements.push(value)
  }
}
