import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Let from "./let.ts"
import { type Statement, validateScopes } from "./statement.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./type.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

type StatementListItem =
  | Let.LetDeclaration
  | Let.ConstDeclaration
  | Fn.FunctionDeclaration<any, any, any>
  | Type.TypeDeclaration<any, any>
  | Stmt.ThrowStatement
  | Stmt.ExprStatement
  | Stmt.IfStatement
  | Stmt.WhileStatement
  | Stmt.ForOfStatement
  | Expr.Assign<any, any>

export function build<A>(
  factory: () => Generator<StatementListItem, A, unknown>,
): Program<A> {
  const iterator = factory()
  const statements: Statement[] = []
  while (true) {
    const next = iterator.next()
    if (next.done) {
      validateScopes(statements)
      return { statements, result: next.value }
    }
    statements.push(next.value)
  }
}
