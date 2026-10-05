import type { Block } from "./block.ts"
import type * as Expr from "./expr.ts"
import type { Phase, Statement } from "./statement.ts"
import * as Type from "./types/index.ts"

export type ValueNode<P extends Phase = Phase> = Expr.Any<P> | Expr.AnyParam | Statement<P> | Block<Statement<P>>

export const absurd = (node: never): never => {
  throw new Error(`unhandled node kind "${(node as { readonly kind: string }).kind}"`)
}

export const children = (node: ValueNode): ReadonlyArray<ValueNode> => {
  const each = (...nodes: ReadonlyArray<Expr.Expr<any> | Block | undefined>): ValueNode[] =>
    nodes.filter((child) => child !== undefined) as ValueNode[]
  switch (node.kind) {
    case "literal":
    case "ref":
    case "external":
    case "param":
    case "type-declaration":
    case "break":
    case "continue":
      return []
    case "prop":
      return each(node.object)
    case "index":
      return each(node.object, node.index)
    case "object":
      return each(...Object.values(node.fields))
    case "array":
      return each(...node.elements)
    case "binary":
      return each(node.left, node.right)
    case "unary":
      return each(node.operand)
    case "template":
      return each(...node.exprs)
    case "cond":
      return each(node.condition, node.then, node.else)
    case "call":
      return each(node.callee, ...node.args)
    case "instantiation":
      return each(node.callee)
    case "arrow":
      return [...node.params, ...each(node.body)]
    case "block":
      return node.statements
    case "let-declaration":
    case "const-declaration":
      return each(node.expr)
    case "function-declaration":
      return node.phase === "built" ? [...node.params, node.body] : node.params
    case "return":
    case "throw":
      return each(node.value)
    case "expr-statement":
      return each(node.expr)
    case "assign":
      return each(node.target, node.value)
    case "if":
      return each(...node.clauses.flatMap((clause) => [clause.condition, clause.body]), node.else)
    case "while":
      return each(node.condition, node.body)
    case "for-of":
      return each(node.iterable, node.body)
    default:
      return absurd(node)
  }
}

export const walk = (root: ValueNode | ReadonlyArray<ValueNode>, visit: (node: ValueNode) => void): void => {
  const go = (node: ValueNode): void => {
    visit(node)
    children(node).forEach(go)
  }
  if (Array.isArray(root)) root.forEach(go)
  else go(root as ValueNode)
}

export const annotations = (node: ValueNode): ReadonlyArray<Type.Type<any>> => {
  switch (node.kind) {
    case "let-declaration":
    case "const-declaration":
      return node.annotation === undefined ? [] : [node.annotation]
    case "param":
      return [node.type]
    case "function-declaration":
    case "arrow":
      return node.returnType === undefined ? node.typeParams : [...node.typeParams, node.returnType]
    case "type-declaration":
      return [...node.params, node.body]
    case "instantiation":
      return node.typeArgs
    default:
      return []
  }
}

export const typeChildren = (type: Type.Type<any>): ReadonlyArray<Type.Type<any>> => {
  const node = type as Type.Any
  switch (node.kind) {
    case "primitive":
    case "literal":
    case "infer-var":
      return []
    case "param":
      return node.extends === undefined ? [] : [node.extends]
    case "template-literal":
      return node.exprs
    case "object":
      return Object.values(node.fields).map((field) => Type.fieldOf(field).type)
    case "union":
    case "intersection":
      return node.members
    case "array":
      return [node.element]
    case "tuple":
      return node.items
    case "function":
      return node.rest === undefined ? [...node.params, node.return] : [...node.params, node.return, node.rest]
    case "indexed-access":
      return [node.object, node.key]
    case "keyof":
      return [node.operand]
    case "logical":
      return [node.left, node.right]
    case "conditional":
      return [node.check, node.extends, node.then, node.else]
    case "mapped":
      return [node.source, node.body]
    case "type-ref":
    case "external":
      return node.args
    default:
      return absurd(node)
  }
}

export const walkType = (root: Type.Type<any>, visit: (node: Type.Any) => void): void => {
  visit(root as Type.Any)
  typeChildren(root).forEach((child) => walkType(child, visit))
}
