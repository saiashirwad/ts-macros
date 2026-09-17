import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import type { BindingId } from "./identity.ts"
import { makeNode, makeStatement } from "./node.ts"
import { validateScopes } from "./scope.ts"
import { Assign, type Block, block, drain, type LValue, materializeValue, type Statement } from "./statement.ts"
import type * as Type from "./types/index.ts"
import { bindingType, blockReturnType, elementType, signatureType } from "./types/lattice.ts"
import { walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

type Declaration = Fn.FunctionDeclaration<any, any, any>

/** the operands were checked when the node was first built, and their types are no longer in view */
const rebuildBinary = Expr.Binary as (op: Expr.BinaryOperator, left: Expr.Expr<any>, right: Expr.Expr<any>) => Expr.Expr<any>

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
      if (node.tag === "function-declaration") {
        const declaration = node as unknown as Declaration
        declarations.set(declaration.id, declaration)
      }
    })
  const bindings = new Map<BindingId, Type.TypeExpr<any> | undefined>()
  const functions = new Map<BindingId, Declaration>()
  const visiting = new Set<BindingId>()

  const withType = <N extends Expr.Expr<any>>(node: N, type: Type.TypeExpr<any> | undefined): N =>
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
    for (const param of declaration.params) bindings.set(param.id, param.type)
    const { impl, ...rest } = declaration
    const raw = impl === undefined ? undefined : materializeValue(() => impl(Fn.paramBindings(declaration.params)))
    register(raw)
    const body = raw === undefined ? undefined : typeBlock(raw)
    const returns = declaration.returnType ?? (body === undefined ? undefined : blockReturnType(body))
    const result: Declaration = makeStatement({ ...rest, body, returnType: returns, type: signatureType(declaration.params, returns) })
    functions.set(declaration.id, result)
    visiting.delete(declaration.id)
    return result
  }

  const expr = (node: Expr.Expr<any>): Expr.Expr<any> => {
    const n = node as Expr.Any | Fn.Any
    switch (n.tag) {
      case "literal":
      case "external-ref":
        return node
      case "var-ref":
        return withType(n, bindings.get(n.target) ?? n.type)
      case "function-ref":
        return withType(n, functionType(n.target) ?? n.type)
      case "prop":
        return Expr.Prop(expr(n.object), n.key as never)
      case "index":
        return Expr.Index(expr(n.object) as Expr.Expr<readonly unknown[]>, expr(n.index) as Expr.Expr<number>)
      case "object":
        return Expr.Object(Object.fromEntries(Object.entries(n.fields).map(([key, value]) => [key, expr(value)])))
      case "array":
        return Expr.Array(...n.elements.map((element: Expr.Expr<any>) => expr(element)))
      case "binary":
        return rebuildBinary(n.op, expr(n.left), expr(n.right))
      case "unary":
        return Expr.Unary(n.op, expr(n.operand))
      case "template":
        return Expr.Template(n.parts, ...n.exprs.map(expr))
      case "cond":
        return Expr.Cond(expr(n.condition) as Expr.Expr<boolean>, expr(n.then), expr(n.else))
      case "call-expr":
        return Fn.Call(expr(n.callee), ...n.args.map(expr) as never)
      case "instantiation":
        return Fn.Instantiate(expr(n.callee) as never, ...n.typeArgs)
      case "arrow": {
        for (const param of n.params) bindings.set(param.id, param.type)
        const body = typeBlock(n.body)
        return makeNode({ ...n, body, type: signatureType(n.params, blockReturnType(body)) })
      }
    }
  }

  const typeBlock = (root: Block): Block => block(root.statements.map(statement))

  const statement = (node: Statement): Statement => {
    switch (node.tag) {
      case "let-declaration":
      case "const-declaration": {
        const init = node.expr === undefined ? undefined : expr(node.expr)
        const type = bindingType(node.tag, node.annotation, init?.type)
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
        return Assign(expr(node.target) as LValue, expr(node.value))
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

type TopLevel = Exclude<Statement, { readonly tag: "return" | "break" | "continue" }>

/** drains the program body, fills in types, and checks that every reference resolves to a declaration in scope */
export const build = <A>(body: () => Generator<TopLevel, A, unknown>): Program<A> => {
  const { statements, result } = drain(body)
  const annotated = annotate(statements)
  validateScopes(annotated)
  return { statements: annotated, result }
}
