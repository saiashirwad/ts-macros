import type { BindingDeclaration } from "./binding.ts"
import type * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import type { BindingId, ValueBinding, ValueReference } from "./identity.ts"
import type { Statement } from "./statement.ts"
import { walk } from "./walk.ts"

export interface ScopeVisitor<Scope> {
  /** called once per block with every binding it declares (hoisted, as in JavaScript) plus any parameters it receives */
  enter(bindings: ReadonlyArray<ValueBinding>, parent: Scope): Scope
  reference(reference: ValueReference, scope: Scope): void
}

const declaredIn = (statements: ReadonlyArray<Statement>): ValueBinding[] =>
  statements.filter((statement): statement is BindingDeclaration | Fn.FunctionDeclaration<any, any, any> =>
    statement.tag === "let-declaration" || statement.tag === "const-declaration" || statement.tag === "function-declaration"
  )

/** visits every block as a scope, reporting the bindings it declares and the references made inside it */
export const visitScopes = <Scope>(statements: ReadonlyArray<Statement>, initial: Scope, visitor: ScopeVisitor<Scope>): void => {
  const visitBlock = (list: ReadonlyArray<Statement>, parent: Scope, params: ReadonlyArray<ValueBinding> = []): void => {
    const scope = visitor.enter([...params, ...declaredIn(list)], parent)

    const expr = (node: Expr.Expr<any>): void => {
      const n = node as Expr.Any | Fn.Any
      switch (n.tag) {
        case "literal":
        case "external-ref":
          return
        case "var-ref":
        case "function-ref":
        case "generic-function-ref":
          return visitor.reference(n, scope)
        case "prop":
          return expr(n.object)
        case "index":
          expr(n.object)
          return expr(n.index)
        case "object":
          return Object.values(n.fields).forEach(expr)
        case "array":
          return n.elements.forEach((element: Expr.Expr<any>) => expr(element))
        case "binary":
          expr(n.left)
          return expr(n.right)
        case "unary":
          return expr(n.operand)
        case "template":
          return n.exprs.forEach(expr)
        case "cond":
          expr(n.condition)
          expr(n.then)
          return expr(n.else)
        case "call-expr":
          expr(n.callee)
          return n.args.forEach(expr)
        case "instantiation":
          return expr(n.callee)
        case "arrow":
          return visitBlock(n.body.statements, scope, n.params)
      }
    }

    for (const statement of list) {
      switch (statement.tag) {
        case "let-declaration":
        case "const-declaration":
          if (statement.expr !== undefined) expr(statement.expr)
          break
        case "function-declaration":
          if (statement.body !== undefined) visitBlock(statement.body.statements, scope, statement.params)
          break
        case "type-declaration":
        case "break":
        case "continue":
          break
        case "return":
        case "throw":
          expr(statement.value)
          break
        case "expr-statement":
          expr(statement.expr)
          break
        case "assign":
          expr(statement.target)
          expr(statement.value)
          break
        case "if":
          for (const clause of statement.clauses) {
            expr(clause.condition)
            visitBlock(clause.body.statements, scope)
          }
          if (statement.else !== undefined) visitBlock(statement.else.statements, scope)
          break
        case "while":
          expr(statement.condition)
          visitBlock(statement.body.statements, scope)
          break
        case "for-of":
          expr(statement.iterable)
          visitBlock(statement.body.statements, scope, [statement])
          break
      }
    }
  }

  visitBlock(statements, initial)
}

/** every reference must resolve to a visible declaration; a name may be declared once per scope */
export const validateScopes = (statements: ReadonlyArray<Statement>): void => {
  const declared = new Set<BindingId>()

  visitScopes(statements, new Set<BindingId>(), {
    enter: (bindings, parent) => {
      const visible = new Set(parent)
      const names = new Set<string>()
      for (const binding of bindings) {
        if (declared.has(binding.id)) {
          throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
        }
        if (names.has(binding.nameHint)) {
          throw new Error(`"${binding.nameHint}" is already declared in this scope`)
        }
        declared.add(binding.id)
        names.add(binding.nameHint)
        visible.add(binding.id)
      }
      return visible
    },
    reference: (reference, visible) => {
      if (!visible.has(reference.target)) {
        throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding`)
      }
    },
  })
}

export type BindingNames = ReadonlyMap<BindingId, string>

/**
 * Picks an emitted name for every binding: its hint, or the hint with a
 * numeric suffix when the hint is already taken by a visible binding or a
 * host value the program refers to.
 */
export const bindingNames = (statements: ReadonlyArray<Statement>): BindingNames => {
  const names = new Map<BindingId, string>()
  const external = new Set<string>()
  walk(statements, (node) => {
    if (node.tag === "external-ref") external.add((node as Expr.ExternalRef<any>).name)
  })

  visitScopes(statements, external as ReadonlySet<string>, {
    enter: (bindings, parent) => {
      const used = new Set(parent)
      for (const binding of bindings) {
        if (names.has(binding.id)) continue
        let name = binding.nameHint
        for (let suffix = 2; used.has(name); suffix++) name = `${binding.nameHint}_${suffix}`
        used.add(name)
        names.set(binding.id, name)
      }
      return used
    },
    reference: () => {},
  })

  return names
}
