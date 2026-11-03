import { type AnyNode, type Expr, expr, exprClass, type Facts } from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

export interface BinaryNode {
  readonly kind: "add" | "less"
  readonly left: AnyNode
  readonly right: AnyNode
}

const binaryClass = exprClass<BinaryNode>({ children: (node) => [node.left, node.right] })

type Defined<T> = [T] extends [never] ? false : true

export const addConstruct = <L extends { readonly Sum: TypeLambda }>() => ({
  add: <A, FA extends Facts, B, FB extends Facts>(
    left: Expr<L, A, FA>,
    right: Expr<L, B, FB> & Check<Defined<Kind<L["Sum"], [A, B]>>, "operands cannot be added", { left: A; right: B }>,
  ): Expr<L, Kind<L["Sum"], [A, B]>, { readonly kind: "add" } | FA | FB> => expr(binaryClass, { kind: "add", left, right }),
})

export const lessConstruct = <L extends { readonly Compare: TypeLambda }>() => ({
  less: <A, FA extends Facts, B, FB extends Facts>(
    left: Expr<L, A, FA>,
    right: Expr<L, B, FB> & Check<Defined<Kind<L["Compare"], [A, B]>>, "operands cannot be compared", { left: A; right: B }>,
  ): Expr<L, Kind<L["Compare"], [A, B]>, { readonly kind: "less" } | FA | FB> => expr(binaryClass, { kind: "less", left, right }),
})
