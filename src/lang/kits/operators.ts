import { type AnyNode, type EvidenceDependencies, type Expr, expr, exprClass, type Facts, type RuntimeType } from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

export interface BinaryNode {
  readonly kind: "add" | "less"
  readonly left: AnyNode
  readonly right: AnyNode
}

const binaryClass = exprClass<BinaryNode>({ children: (node) => [node.left, node.right] })

type Defined<T> = [T] extends [never] ? false : true

export const addConstruct = <L extends { readonly Sum: TypeLambda }>(result: (left: RuntimeType, right: RuntimeType) => RuntimeType) => ({
  add: <A, FA extends Facts, B, FB extends Facts, EA, EB>(
    left: Expr<L, A, FA, EA>,
    right: Expr<L, B, FB, EB> & Check<Defined<Kind<L["Sum"], [A, B]>>, "operands cannot be added", { left: A; right: B }>,
  ): Expr<
    L,
    Kind<L["Sum"], [A, B]>,
    { readonly kind: "add" } | FA | FB | EvidenceDependencies<EA> | EvidenceDependencies<EB>,
    [EA | EB] extends ["complete"] ? "complete" : "unavailable"
  > =>
    expr<
      L,
      Kind<L["Sum"], [A, B]>,
      { readonly kind: "add" } | FA | FB | EvidenceDependencies<EA> | EvidenceDependencies<EB>,
      [EA | EB] extends ["complete"] ? "complete" : "unavailable"
    >(
      binaryClass,
      { kind: "add", left, right },
      result(left.type, right.type),
    ),
})

export const lessConstruct = <L extends { readonly Compare: TypeLambda }>(result: (left: RuntimeType, right: RuntimeType) => RuntimeType) => ({
  less: <A, FA extends Facts, B, FB extends Facts, EA, EB>(
    left: Expr<L, A, FA, EA>,
    right: Expr<L, B, FB, EB> & Check<Defined<Kind<L["Compare"], [A, B]>>, "operands cannot be compared", { left: A; right: B }>,
  ): Expr<
    L,
    Kind<L["Compare"], [A, B]>,
    { readonly kind: "less" } | FA | FB | EvidenceDependencies<EA> | EvidenceDependencies<EB>,
    [EA | EB] extends ["complete"] ? "complete" : "unavailable"
  > =>
    expr<
      L,
      Kind<L["Compare"], [A, B]>,
      { readonly kind: "less" } | FA | FB | EvidenceDependencies<EA> | EvidenceDependencies<EB>,
      [EA | EB] extends ["complete"] ? "complete" : "unavailable"
    >(
      binaryClass,
      { kind: "less", left, right },
      result(left.type, right.type),
    ),
})
