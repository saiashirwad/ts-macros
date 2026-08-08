import * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import { type Statement, validateScopes } from "./statement.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
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
      validateScopes(statements)
      return { statements, result: value }
    }
    statements.push(value)
  }
}
