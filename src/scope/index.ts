import * as Binding from "../binding.ts"
import * as Expr from "../expr.ts"
import * as Fn from "../function.ts"
import type { ValueBinding } from "../identity.ts"
import * as Stmt from "../statement.ts"
import * as TypeDeclaration from "../types/declaration.ts"
import type { ExpressionScopeHandlers, ScopeCursor, StatementScopeBehavior, StatementScopeHandlers, ValueScopeVisitor } from "./protocol.ts"

const expressionHandlers = {
  ...Expr.expressionScopeHandlers,
  ...Fn.functionExpressionScopeHandlers,
} satisfies ExpressionScopeHandlers<Expr.Any | Fn.Any>

const statementHandlers = {
  ...Binding.bindingScopeHandlers,
  ...Fn.functionStatementScopeHandlers,
  ...Stmt.statementScopeHandlers,
  ...TypeDeclaration.typeDeclarationScopeHandlers,
} satisfies StatementScopeHandlers<Stmt.Statement>

const expressionHandler = (node: Expr.Any | Fn.Any): (node: Expr.Any | Fn.Any, cursor: ScopeCursor) => void =>
  expressionHandlers[node.tag] as unknown as (node: Expr.Any | Fn.Any, cursor: ScopeCursor) => void

const statementBehavior = (statement: Stmt.Statement): StatementScopeBehavior<Stmt.Statement> | undefined =>
  statementHandlers[statement.tag] as unknown as StatementScopeBehavior<Stmt.Statement> | undefined

export const visitValueScopes = <State>(
  statements: ReadonlyArray<Stmt.Statement>,
  initial: State,
  visitor: ValueScopeVisitor<State>,
): void => {
  const visitStatements = (
    list: ReadonlyArray<Stmt.Statement>,
    parent: State,
    initialBindings: ReadonlyArray<ValueBinding> = [],
  ): void => {
    const bindings = [...initialBindings]
    for (const statement of list) {
      const behavior = statementBehavior(statement)
      if (behavior !== undefined) bindings.push(...behavior.bindings(statement))
    }

    const state = visitor.enterScope(bindings, parent)
    const cursor: ScopeCursor = {
      expression: (expression) => {
        const node = expression as Expr.Any | Fn.Any
        expressionHandler(node)(node, cursor)
      },
      childScope: (children, childBindings = []) => {
        visitStatements(children, state, childBindings)
      },
      reference: (reference) => visitor.reference(reference, state),
    }

    for (const statement of list) {
      statementBehavior(statement)?.visit(statement, cursor)
    }
  }

  visitStatements(statements, initial)
}
