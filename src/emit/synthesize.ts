import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Statement } from "../statement.ts"
import { inferProgram, type TypeNode, type TypeOracle } from "./infer.ts"

export type { TypeNode, TypeOracle } from "./infer.ts"

export interface Synthesis {
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

export const synthesize = (statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Synthesis => {
  const infer = inferProgram(statements, oracle)
  return {
    tryTypeOf: infer.tryTypeOf,
    typeOfFunction: infer.typeOfFunction,
  }
}
