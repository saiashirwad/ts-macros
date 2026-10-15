import { type AnyNode, type EvidenceDependencies, type Expr, expr, exprClass, type Facts, type RuntimeType } from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

export interface BinaryNode {
  readonly kind: "add" | "less"
  readonly left: AnyNode
  readonly right: AnyNode
}

const binaryClass = exprClass<BinaryNode>({ children: (node) => [node.left, node.right] })

type Defined<T> = [T] extends [never] ? false : true

type Binary<L, K extends string, D, FA extends Facts, FB extends Facts, EA, EB> = Expr<
  L,
  D,
  { readonly kind: K } | FA | FB | EvidenceDependencies<EA> | EvidenceDependencies<EB>,
  [EA | EB] extends ["complete"] ? "complete" : "unavailable"
>

export const addConstruct = <L extends { readonly Sum: TypeLambda }>(result: (left: RuntimeType, right: RuntimeType) => RuntimeType) => ({
  add: <A, FA extends Facts, B, FB extends Facts, EA, EB>(
    left: Expr<L, A, FA, EA>,
    right: Expr<L, B, FB, EB> & Check<Defined<Kind<L["Sum"], [A, B]>>, "operands cannot be added", { left: A; right: B }>,
  ): Binary<L, "add", Kind<L["Sum"], [A, B]>, FA, FB, EA, EB> => expr(binaryClass, { kind: "add", left, right }, result(left.type, right.type)),
})

export const lessConstruct = <L extends { readonly Compare: TypeLambda }>(result: (left: RuntimeType, right: RuntimeType) => RuntimeType) => ({
  less: <A, FA extends Facts, B, FB extends Facts, EA, EB>(
    left: Expr<L, A, FA, EA>,
    right: Expr<L, B, FB, EB> & Check<Defined<Kind<L["Compare"], [A, B]>>, "operands cannot be compared", { left: A; right: B }>,
  ): Binary<L, "less", Kind<L["Compare"], [A, B]>, FA, FB, EA, EB> => expr(binaryClass, { kind: "less", left, right }, result(left.type, right.type)),
})
