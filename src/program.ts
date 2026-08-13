import { type Statement, validateScopes } from "./statement.ts"
import type * as Stmt from "./statement.ts"

export interface Program<A> {
  readonly statements: ReadonlyArray<Statement>
  readonly result: A
}

// no return/break/continue at the top level
type StatementListItem = Exclude<Statement, Stmt.ReturnStatement<any> | Stmt.BreakStatement | Stmt.ContinueStatement>

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
