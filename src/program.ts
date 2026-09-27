import {
  type Any as AnyExpr,
  array,
  type Arrow,
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
import { assign, type Block, block, drain, type LValue, type NonLoopStatement, type Statement } from "./statement.ts"
import type * as Type from "./types/index.ts"
import { bindingType, blockReturnType, elementType, paramBindingType, signatureType } from "./typing.ts"
import { walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

type Declaration = Extract<Statement, { readonly kind: "function-declaration" }>

/** the operands were checked when the node was first built, and their types are no longer in view */
const rebuildBinary = binary as unknown as (op: BinaryOperator, left: Expr<any>, right: Expr<any>) => Expr<any>

/**
 * Rebuilds a statement list with every type that can be known filled in.
 *
 * Constructors attach types bottom-up as nodes are built, so most nodes
 * already carry one. What construction cannot know is resolved here: the
 * signature of a function whose body was not yet run (its `impl` runs here,
 * on demand, so calls to later or recursive declarations resolve), and the
 * type of a reference to a binding typed after the reference was made. Every
 * node is rebuilt through its constructor, so the typing rules live in the
 * constructors alone.
 */
const annotate = (statements: ReadonlyArray<Statement>): Statement[] => {
  const declarations = new Map<BindingId, Declaration>()
  const register = (root: unknown): void =>
    walk(root, (node) => {
      if (node.kind === "function-declaration") declarations.set((node as Declaration).id, node as Declaration)
    })
  const bindings = new Map<BindingId, Type.Type<any> | undefined>()
  const functions = new Map<BindingId, Declaration>()
  const visiting = new Set<BindingId>()

  const withType = <N extends Expr<any>>(node: N, type: Type.Type<any> | undefined): N =>
    type === undefined || type === node.type ? node : makeNode({ ...node, type })

  const functionType = (id: BindingId): Type.FunctionType | undefined => {
    const declaration = declarations.get(id)
    if (declaration === undefined) return undefined
    // a recursive edge sees only what was declared
    if (visiting.has(id)) return signatureType(declaration.params, declaration.returnType)
    return typeFunction(declaration).type
  }

  const typeFunction = (declaration: Declaration): Declaration => {
    const typed = functions.get(declaration.id)
    if (typed !== undefined) return typed
    visiting.add(declaration.id)
    for (const item of declaration.params) bindings.set(item.id, paramBindingType(item))
    const { impl, ...rest } = declaration
    const raw = impl === undefined ? undefined : materializeBody(() => impl(paramBindings(declaration.params)))
    register(raw)
    const body = raw === undefined ? undefined : typeBlock(raw)
    const returns = declaration.returnType ?? (body === undefined ? undefined : blockReturnType(body))
    // `returnType` stays what the user declared; what was inferred goes in `type`, as it does for a binding
    const result: Declaration = makeStatement({ ...rest, body, type: signatureType(declaration.params, returns) })
    functions.set(declaration.id, result)
    visiting.delete(declaration.id)
    return result
  }

  const expr = (node: Expr<any>): Expr<any> => {
    const n = node as AnyExpr
    switch (n.kind) {
      case "literal":
        return n
      case "ref": {
        if (n.id === undefined) return n
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
        return makeNode({ ...n, body, type: signatureType(n.params, blockReturnType(body)) })
      }
      default:
        return node
    }
  }

  const typeBlock = (root: Block): Block => block(root.statements.map(statement))

  const statement = (node: Statement): Statement => {
    switch (node.kind) {
      case "let-declaration":
      case "const-declaration": {
        const init = node.expr === undefined ? undefined : expr(node.expr)
        const type = bindingType(node.kind, node.annotation, init)
        bindings.set(node.id, type)
        return makeStatement({ ...node, expr: init, type })
      }
      case "function-declaration":
        return typeFunction(node)
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

const validateControlFlow = (statements: ReadonlyArray<Statement>, inLoop = false, seenArrows = new WeakSet<object>()): void => {
  walk(statements, (node) => {
    if (node.kind !== "arrow" || seenArrows.has(node)) return
    seenArrows.add(node)
    validateControlFlow((node as Arrow).body.statements, false, seenArrows)
  })

  for (const statement of statements) {
    switch (statement.kind) {
      case "break":
      case "continue":
        if (!inLoop) throw new Error(`${statement.kind} requires an enclosing loop`)
        break
      case "function-declaration":
        if (statement.body !== undefined) validateControlFlow(statement.body.statements, false, seenArrows)
        break
      case "if":
        for (const clause of statement.clauses) validateControlFlow(clause.body.statements, inLoop, seenArrows)
        if (statement.else !== undefined) validateControlFlow(statement.else.statements, inLoop, seenArrows)
        break
      case "while":
      case "for-of":
        validateControlFlow(statement.body.statements, true, seenArrows)
        break
      default:
        break
    }
  }
}

/** drains the program body, fills in types, and validates scopes and control-flow targets */
export const build = <A>(body: () => Generator<TopLevel, A, unknown>): Program<A> => {
  const { statements, result } = drain(body)
  const annotated = annotate(statements)
  validateControlFlow(annotated)
  validateScopes(annotated)
  return { statements: annotated, result }
}
