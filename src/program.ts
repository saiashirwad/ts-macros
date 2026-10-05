import { type Block, block, drain } from "./block.ts"
import type { BuiltFunction, PendingFunction } from "./declaration.ts"
import {
  type Any as AnyExpr,
  array,
  binary,
  type BinaryOperator,
  call,
  cond,
  type Expr,
  index,
  instantiate,
  materializeBody,
  object,
  paramBindings,
  prop,
  template,
  unary,
} from "./expr.ts"
import type { BindingId } from "./identity.ts"
import { makeNode, makeStatement } from "./node.ts"
import { validateScopes } from "./scope.ts"
import { assign, type LValue, type NonLoopStatement, type Statement } from "./statement.ts"
import type * as Type from "./types/index.ts"
import { bindingType, blockReturnType, elementType, paramBindingType, signatureType } from "./typing.ts"
import { absurd, children, type ValueNode, walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement<"built">>
  readonly result: A
}

const rebuildBinary = binary as unknown as (op: BinaryOperator, left: Expr<any>, right: Expr<any>) => Expr<any>

const annotate = (statements: ReadonlyArray<Statement>): Statement<"built">[] => {
  const declarations = new Map<BindingId, PendingFunction>()
  const register = (root: ReadonlyArray<Statement> | Block): void =>
    walk(root, (node) => {
      if (node.kind === "function-declaration" && node.phase === "pending") declarations.set(node.id, node)
    })
  const bindings = new Map<BindingId, Type.Type<any> | undefined>()
  const functions = new Map<BindingId, BuiltFunction>()
  const visiting = new Set<BindingId>()

  const withType = <N extends Expr<any>>(node: N, type: Type.Type<any> | undefined): N =>
    type === undefined || type === node.type ? node : makeNode({ ...node, type })

  const functionType = (id: BindingId): Type.FunctionType | undefined => {
    const declaration = declarations.get(id)
    if (declaration === undefined) return undefined
    if (visiting.has(id)) return signatureType(declaration.params, declaration.returnType)
    return typeFunction(declaration).type
  }

  const typeFunction = (declaration: PendingFunction): BuiltFunction => {
    const typed = functions.get(declaration.id)
    if (typed !== undefined) return typed
    visiting.add(declaration.id)
    for (const item of declaration.params) bindings.set(item.id, paramBindingType(item))
    const { impl, phase: _pending, ...head } = declaration
    const raw = materializeBody(() => impl(paramBindings(declaration.params)))
    register(raw)
    const body = typeBlock(raw)
    const returns = declaration.returnType ?? blockReturnType(body)
    const result: BuiltFunction = makeStatement({ ...head, phase: "built", body, type: signatureType(declaration.params, returns) })
    functions.set(declaration.id, result)
    visiting.delete(declaration.id)
    return result
  }

  const expr = (node: Expr<any>): Expr<any> => {
    const n = node as AnyExpr
    switch (n.kind) {
      case "literal":
        return n
      case "external":
        return n
      case "ref": {
        const fnType = declarations.has(n.id) ? functionType(n.id) ?? n.type : undefined
        return withType(n, fnType ?? bindings.get(n.id) ?? n.type)
      }
      case "prop":
        return prop(expr(n.object), n.key as never)
      case "index":
        return index(expr(n.object) as Expr<readonly unknown[]>, expr(n.index) as Expr<number>)
      case "object":
        return object(globalThis.Object.fromEntries(globalThis.Object.entries(n.fields).map(([key, value]) => [key, expr(value)])))
      case "array":
        return array(...n.elements.map((element: Expr<any>) => expr(element)))
      case "binary":
        return rebuildBinary(n.op, expr(n.left), expr(n.right))
      case "unary":
        return unary(n.op, expr(n.operand))
      case "template":
        return template(n.parts, ...(n.exprs.map(expr) as never[]))
      case "cond":
        return cond(expr(n.condition) as Expr<boolean>, expr(n.then), expr(n.else))
      case "call":
        return call(expr(n.callee) as never, ...(n.args.map(expr) as never[]))
      case "instantiation":
        return instantiate(expr(n.callee) as never, ...n.typeArgs as never)
      case "arrow": {
        for (const item of n.params) bindings.set(item.id, paramBindingType(item))
        const body = typeBlock(n.body)
        return makeNode({ ...n, body, type: signatureType(n.params, n.returnType ?? blockReturnType(body)) })
      }
      default:
        return absurd(n)
    }
  }

  const typeBlock = (root: Block): Block<Statement<"built">> => block(root.statements.map(statement))

  const statement = (node: Statement): Statement<"built"> => {
    switch (node.kind) {
      case "let-declaration":
      case "const-declaration": {
        const init = node.expr === undefined ? undefined : expr(node.expr)
        const type = bindingType(node.kind, node.annotation, init)
        bindings.set(node.id, type)
        return makeStatement({ ...node, expr: init, type })
      }
      case "function-declaration":
        return node.phase === "built" ? node : typeFunction(node)
      case "type-declaration":
      case "break":
      case "continue":
        return node
      case "return":
      case "throw":
        return makeStatement({ ...node, value: expr(node.value) })
      case "expr-statement":
        return makeStatement({ ...node, expr: expr(node.expr) })
      case "assign":
        return assign(expr(node.target) as LValue, expr(node.value))
      case "if":
        return makeStatement({
          ...node,
          clauses: node.clauses.map((clause) => ({ condition: expr(clause.condition), body: typeBlock(clause.body) })),
          else: node.else === undefined ? undefined : typeBlock(node.else),
        })
      case "while":
        return makeStatement({ ...node, condition: expr(node.condition), body: typeBlock(node.body) })
      case "for-of": {
        const iterable = expr(node.iterable)
        bindings.set(node.id, elementType(iterable.type))
        return makeStatement({ ...node, iterable, body: typeBlock(node.body) })
      }
    }
  }

  register(statements)
  return statements.map(statement)
}

type TopLevel = Exclude<NonLoopStatement, { readonly kind: "return" }>

const validateControlFlow = (node: ValueNode, inLoop: boolean): void => {
  switch (node.kind) {
    case "break":
    case "continue":
      if (!inLoop) throw new Error(`${node.kind} requires an enclosing loop`)
      return
    case "while":
    case "for-of":
      return children(node).forEach((child) => validateControlFlow(child, true))
    case "arrow":
    case "function-declaration":
      return children(node).forEach((child) => validateControlFlow(child, false))
    default:
      return children(node).forEach((child) => validateControlFlow(child, inLoop))
  }
}

/** drains the program body, fills in types, and validates control-flow targets, scopes, and type names */
export const build = <A>(body: () => Generator<TopLevel, A, unknown>): Program<A> => {
  const { statements, result } = drain(body)
  const annotated = annotate(statements)
  annotated.forEach((statement) => validateControlFlow(statement, false))
  validateScopes(annotated)
  return { statements: annotated, result }
}
