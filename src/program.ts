import * as Binding from "./binding.ts"
import { widen } from "./emit/type-ir.ts"
import * as Expr from "./expr.ts"
import { type AnyParams, type FunctionImpl, paramBindings } from "./function.ts"
import type * as Fn from "./function.ts"
import { validateScopes } from "./scope/validate.ts"
import { type Block, collectReturns, materializeValue, type Statement } from "./statement.ts"
import type * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"
import { walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

const materialize = (statements: ReadonlyArray<Statement>): void => {
  walk(statements, (node) => {
    if (node.tag !== "function-declaration") return
    const decl = node as unknown as {
      impl?: FunctionImpl<AnyParams, unknown> | undefined
      body?: Block
      returnType?: Type.TypeExpr<any>
      type?: Type.TypeExpr<any>
      readonly params: AnyParams
    }
    const { impl, params } = decl
    if (impl === undefined) return
    delete (decl as any).impl
    const body = materializeValue(() => impl(paramBindings(params)))
    decl.body = body

    if (decl.returnType === undefined) {
      const returns = collectReturns(body)
      if (returns.length === 0) {
        decl.returnType = Type.Void()
      } else {
        const types = returns.map((r) => r.type).filter((t): t is Type.TypeExpr<any> => t !== undefined)
        if (types.length > 0) {
          decl.returnType = widen(types[types.length - 1]!)
        }
      }
    }
    if (decl.returnType !== undefined) {
      decl.type = Type.Function(params.map((p) => p.type), decl.returnType)
    }
  })
}

type StatementListItem =
  | Binding.BindingDeclaration
  | Fn.FunctionDeclaration<any, any, any>
  | Type.TypeDeclaration<any, any>
  | Stmt.ThrowStatement
  | Stmt.ExprStatement
  | Stmt.IfStatement
  | Stmt.WhileStatement
  | Stmt.ForOfStatement
  | Expr.Assign<any, any>

export function build<A>(
  body: () => Generator<StatementListItem, A, unknown>,
): Program<A> {
  const iterator = body()
  const statements: Statement[] = []
  while (true) {
    const { value, done } = iterator.next()
    if (done) {
      materialize(statements)
      validateScopes(statements)
      return { statements, result: value }
    }
    statements.push(value)
  }
}
