import * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Statement } from "../statement.ts"
import * as Type from "../types/index.ts"

type TypeNode = Type.TypeExpr<any>

export interface TypeOracle {
  externalRef?(node: Expr.ExternalRef<any>): TypeNode | null
  typeRef?(node: Type.TypeRef<any>): TypeNode | null
}

export interface Synthesis {
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

export const synthesize = (_statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Synthesis => ({
  tryTypeOf: (expr) => {
    const node = expr as Expr.Any | Fn.Any
    const resolved = Expr.resolveExternalTypes(expr, (external) => oracle?.externalRef?.(external) ?? null)
    if (resolved.type !== undefined) return resolved.type
    if (node.tag === "call-expr") {
      const callee = Expr.resolveExternalTypes(node.callee, (external) => oracle?.externalRef?.(external) ?? null)
      const calleeType = callee.type as Type.Any | undefined
      if (calleeType?.tag === "function") return calleeType.return
    }
    return node.tag === "external-ref" ? oracle?.externalRef?.(node) ?? null : null
  },
  typeOfFunction: (node) =>
    node.type
      ?? (node.returnType === undefined ? null : Type.Function(node.params.map((param: Fn.AnyParam) => param.type), node.returnType)),
})
