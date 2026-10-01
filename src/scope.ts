import type { BindingDeclaration, FunctionDeclaration, TypeDeclaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import { validateParamNames } from "./expr.ts"
import type { BindingId, ValueBinding } from "./identity.ts"
import type { Statement } from "./statement.ts"
import { absurd, annotations, type ValueNode, walk, walkType } from "./walk.ts"

export interface ScopeVisitor<Scope> {
  /** called once per block with every binding it declares (hoisted, as in JavaScript) plus any parameters it receives */
  enter(bindings: ReadonlyArray<ValueBinding>, parent: Scope): Scope
  reference(reference: ValueBinding, scope: Scope): void
}

const declaredIn = (statements: ReadonlyArray<Statement<"built">>): ValueBinding[] =>
  statements.filter((statement): statement is BindingDeclaration | FunctionDeclaration<any, any, any, "built"> | TypeDeclaration<any, any> =>
    statement.kind === "let-declaration" || statement.kind === "const-declaration" || statement.kind === "function-declaration"
    || statement.kind === "type-declaration"
  )

/** visits every block as a scope, reporting the bindings it declares and the references made inside it */
export const visitScopes = <Scope>(statements: ReadonlyArray<Statement<"built">>, initial: Scope, visitor: ScopeVisitor<Scope>): void => {
  const visitBlock = (list: ReadonlyArray<Statement<"built">>, parent: Scope, params: ReadonlyArray<ValueBinding> = []): void => {
    validateParamNames(params)
    const scope = visitor.enter([...params, ...declaredIn(list)], parent)
    const types = (node: ValueNode): void => {
      for (const root of annotations(node)) {
        walkType(root, (type) => {
          if (type.kind === "type-ref") visitor.reference(type, scope)
        })
      }
    }
    params.forEach((param) => types(param as Expr.AnyParam))

    const expr = (node: Expr.Expr<any>): void => {
      const n = node as Expr.Any<"built">
      types(n)
      switch (n.kind) {
        case "literal":
          return
        case "external":
          return
        case "ref":
          return visitor.reference(n, scope)
        case "prop":
          return expr(n.object)
        case "index":
          expr(n.object)
          return expr(n.index)
        case "object":
          return globalThis.Object.values(n.fields).forEach(expr)
        case "array":
          return n.elements.forEach(expr)
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
        case "call":
          expr(n.callee)
          return n.args.forEach(expr)
        case "instantiation":
          return expr(n.callee)
        case "arrow":
          return visitBlock(n.body.statements, scope, n.params)
        default:
          return absurd(n)
      }
    }

    for (const statement of list) {
      types(statement)
      switch (statement.kind) {
        case "let-declaration":
        case "const-declaration":
          if (statement.expr !== undefined) expr(statement.expr)
          break
        case "function-declaration":
          visitBlock(statement.body.statements, scope, statement.params)
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
        default:
          absurd(statement)
      }
    }
  }

  visitBlock(statements, initial)
}

/** scope extrusion is checked at build time, not in the types: every reference must resolve to a visible identity */
export const validateScopes = (statements: ReadonlyArray<Statement<"built">>): void => {
  const declared = new Set<BindingId>()

  visitScopes(statements, new Set<BindingId>(), {
    enter: (bindings, parent) => {
      const visible = new Set(parent)
      for (const binding of bindings) {
        if (declared.has(binding.id)) {
          throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
        }
        declared.add(binding.id)
        visible.add(binding.id)
      }
      return visible
    },
    reference: (reference, visible) => {
      if (!visible.has(reference.id)) {
        throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding (scope extrusion is checked at build time)`)
      }
    },
  })
}

export type BindingNames = ReadonlyMap<BindingId, string>

/**
 * Picks an emitted name for every binding: its hint, or the hint with a
 * numeric suffix when the hint is already taken by a visible binding or a
 * host value or type-level binder the program refers to.
 */
export const bindingNames = (statements: ReadonlyArray<Statement<"built">>): BindingNames => {
  const names = new Map<BindingId, string>()
  // Reserve type binders before assigning ancestor names too: a reference to
  // an outer alias must not be captured inside a mapped/conditional type.
  const reserved = new Set<string>()
  walk(statements, (node) => {
    if (node.kind === "external") reserved.add(node.name)
    for (const root of annotations(node)) {
      walkType(root, (type) => {
        if (type.kind === "external" || type.kind === "param" || type.kind === "infer-var") reserved.add(type.name)
        else if (type.kind === "mapped") reserved.add(type.key)
      })
    }
  })

  visitScopes(statements, reserved as ReadonlySet<string>, {
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
