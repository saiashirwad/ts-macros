import type { Block } from "./block.ts"
import type * as Expr from "./expr.ts"
import type { Statement } from "./statement.ts"

/** every node of the value tree; type annotations are not part of it */
export type ValueNode = Expr.Any | Expr.AnyParam | Statement | Block

/** thrown by a switch over node kinds when a kind is not handled; `node: never` makes a missing case a type error */
export const absurd = (node: never): never => {
  throw new Error(`unhandled node kind "${(node as { readonly kind: string }).kind}"`)
}

/** the value nodes directly inside `node`, in source order */
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
      return [...node.params, ...each(node.body)]
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

/** visits every node under `root`, in pre-order */
export const walk = (root: ValueNode | ReadonlyArray<ValueNode>, visit: (node: ValueNode) => void): void => {
  const go = (node: ValueNode): void => {
    visit(node)
    children(node).forEach(go)
  }
  if (Array.isArray(root)) root.forEach(go)
  else go(root as ValueNode)
}
