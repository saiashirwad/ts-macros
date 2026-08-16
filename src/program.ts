import * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import { type AnyParams, type FunctionDeclaration, type FunctionImpl, paramBindings } from "./function.ts"
import type * as Fn from "./function.ts"
import { type Block, materializeValue, type Statement, validateScopes } from "./statement.ts"
import type * as Stmt from "./statement.ts"
import type * as Type from "./types/index.ts"
import { walk } from "./walk.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

const materialize = (statements: ReadonlyArray<Statement>): void => {
  walk(statements, (node) => {
    if (node.tag !== "function-declaration") return
    const decl = node as unknown as { impl?: FunctionImpl<AnyParams, unknown>; body?: Block; readonly params: AnyParams }
    const impl = decl.impl
    if (impl === undefined) return
    delete decl.impl
    decl.body = materializeValue(() => impl(paramBindings(decl.params)))
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
