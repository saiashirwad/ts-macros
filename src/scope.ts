import type { BindingDeclaration, FunctionDeclaration, TypeDeclaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import type { BindingId, ValueBinding } from "./node.ts"
import type { Statement } from "./statement.ts"
import { annotations, children, type ValueNode, walk, walkType } from "./walk.ts"

export interface ScopeVisitor<Scope> {
  enter(bindings: ReadonlyArray<ValueBinding>, parent: Scope): Scope
  reference(reference: ValueBinding, scope: Scope): void
}

const declaredIn = (statements: ReadonlyArray<Statement<"built">>): ValueBinding[] =>
  statements.filter((statement): statement is BindingDeclaration | FunctionDeclaration<any, any, any, "built"> | TypeDeclaration<any, any> =>
    statement.kind === "let-declaration" || statement.kind === "const-declaration" || statement.kind === "function-declaration"
    || statement.kind === "type-declaration"
  )

export const visitScopes = <Scope>(statements: ReadonlyArray<Statement<"built">>, initial: Scope, visitor: ScopeVisitor<Scope>): void => {
  const typeRefs = (node: ValueNode, scope: Scope): void => {
    for (const root of annotations(node)) {
      walkType(root, (type) => {
        if (type.kind === "type-ref") visitor.reference(type, scope)
      })
    }
  }

  const visitBlock = (list: ReadonlyArray<Statement<"built">>, parent: Scope, binders: ReadonlyArray<ValueBinding> = []): Scope => {
    const scope = visitor.enter([...binders, ...declaredIn(list)], parent)
    list.forEach((statement) => visit(statement, scope))
    return scope
  }

  const visit = (child: ValueNode | Expr.Expr<any>, scope: Scope): void => {
    const node = child as ValueNode<"built">
    typeRefs(node, scope)
    switch (node.kind) {
      case "ref":
        return visitor.reference(node, scope)
      case "block":
        visitBlock(node.statements, scope)
        return
      case "arrow":
      case "function-declaration": {
        const inner = visitBlock(node.body.statements, scope, node.params)
        for (const param of node.params) typeRefs(param, inner)
        return
      }
      case "for-of":
        visit(node.iterable, scope)
        visitBlock(node.body.statements, scope, [node])
        return
      default:
        return children(node).forEach((next) => visit(next, scope))
    }
  }

  visitBlock(statements, initial)
}

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

const hostAndTypeBinderNames = (statements: ReadonlyArray<Statement<"built">>): ReadonlySet<string> => {
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
  return reserved
}

export const bindingNames = (statements: ReadonlyArray<Statement<"built">>): BindingNames => {
  const names = new Map<BindingId, string>()
  visitScopes(statements, hostAndTypeBinderNames(statements), {
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
