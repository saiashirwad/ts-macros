import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { BindingId } from "../identity.ts"
import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"

export type BindingNames = ReadonlyMap<BindingId, string>

interface NamedBinding {
  readonly id: BindingId
  readonly nameHint: string
}

const freshName = (nameHint: string, used: Set<string>): string => {
  if (!used.has(nameHint)) {
    used.add(nameHint)
    return nameHint
  }
  let suffix = 2
  while (used.has(`${nameHint}_${suffix}`)) suffix++
  const name = `${nameHint}_${suffix}`
  used.add(name)
  return name
}

export const collectBindingNames = (statements: ReadonlyArray<Statement>): BindingNames => {
  const names = new Map<BindingId, string>()
  const externalNames = new Set<string>()

  walk(statements, (node) => {
    if (node.tag === "external-ref") {
      externalNames.add((node as unknown as Expr.ExternalRef<any>).name)
    }
  })

  const allocate = (binding: NamedBinding, used: Set<string>): void => {
    if (names.has(binding.id)) return
    names.set(binding.id, freshName(binding.nameHint, used))
  }

  const planExpression = (expression: Expr.Expr<any>, used: ReadonlySet<string>): void => {
    const node = expression as Expr.Any | Fn.Any
    switch (node.tag) {
      case "literal":
      case "external-ref":
      case "var-ref":
      case "function-ref":
      case "generic-function-ref":
        return
      case "prop":
        planExpression(node.object, used)
        return
      case "index":
        planExpression(node.object, used)
        planExpression(node.index, used)
        return
      case "array":
        node.elements.forEach((element: Expr.Expr<any>) => planExpression(element, used))
        return
      case "object":
        Object.values(node.fields).forEach((field) => planExpression(field, used))
        return
      case "call-expr":
        planExpression(node.callee, used)
        node.args.forEach((argument) => planExpression(argument, used))
        return
      case "instantiation":
        planExpression(node.callee, used)
        return
      case "arrow":
        planStatements(node.body.statements, used, node.params)
        return
      case "binary":
        planExpression(node.left, used)
        planExpression(node.right, used)
        return
      case "unary":
        planExpression(node.operand, used)
        return
      case "template":
        node.exprs.forEach((part) => planExpression(part, used))
        return
      case "cond":
        planExpression(node.condition, used)
        planExpression(node.then, used)
        planExpression(node.else, used)
        return
      case "assign":
        planExpression(node.target, used)
        planExpression(node.value, used)
        return
    }
  }

  const planStatements = (
    list: ReadonlyArray<Statement>,
    outerUsed: ReadonlySet<string>,
    initial: ReadonlyArray<NamedBinding> = [],
  ): void => {
    const used = new Set(outerUsed)
    initial.forEach((binding) => allocate(binding, used))
    for (const statement of list) {
      if (statement.tag === "let-declaration" || statement.tag === "const-declaration" || statement.tag === "function-declaration") {
        allocate(statement, used)
      }
    }

    for (const statement of list) {
      switch (statement.tag) {
        case "let-declaration":
        case "const-declaration":
          if (statement.expr !== undefined) planExpression(statement.expr, used)
          break
        case "function-declaration":
          if (statement.body !== undefined) planStatements(statement.body.statements, used, statement.params)
          break
        case "type-declaration":
        case "break":
        case "continue":
          break
        case "return":
        case "throw":
          planExpression(statement.value, used)
          break
        case "expr-statement":
          planExpression(statement.expr, used)
          break
        case "assign":
          planExpression(statement, used)
          break
        case "if":
          for (const clause of statement.clauses) {
            planExpression(clause.condition, used)
            planStatements(clause.body.statements, used)
          }
          if (statement.else !== null) planStatements(statement.else.statements, used)
          break
        case "while":
          planExpression(statement.condition, used)
          planStatements(statement.body.statements, used)
          break
        case "for-of":
          planExpression(statement.iterable, used)
          planStatements(statement.body.statements, used, [statement])
          break
      }
    }
  }

  planStatements(statements, externalNames)
  return names
}

export const resolveBindingName = (names: BindingNames | undefined, id: BindingId, nameHint: string): string => names?.get(id) ?? nameHint
