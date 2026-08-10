import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Program } from "../program.ts"
import type { Block, Statement } from "../statement.ts"
import { assertNever, ident } from "./shared.ts"
import { statementToBabel } from "./statement.ts"

interface ImportBinding {
  readonly local: string
  readonly source: string
}

const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()

  const add = (name: string, source: string): void => {
    const key = `${source} ${name}`
    if (!found.has(key)) found.set(key, { local: name, source })
  }

  const fromExpr = (expr: Expr.Expr<any>): void => {
    const node = expr as Expr.Any | Fn.Any
    switch (node.tag) {
      case "literal":
      case "function-ref":
      case "generic-function-ref":
        return
      case "var-ref":
        if (node.source !== undefined) add(node.name, node.source)
        return
      case "prop":
        return fromExpr(node.object)
      case "index":
        fromExpr(node.object)
        return fromExpr(node.index)
      case "array":
        node.elements.forEach(fromExpr)
        return
      case "object":
        Object.values(node.fields).forEach(fromExpr)
        return
      case "call-expr":
        fromExpr(node.callee)
        node.args.forEach(fromExpr)
        return
      case "instantiation":
        return fromExpr(node.callee)
      case "arrow":
        return fromBlock(node.body)
      case "binary":
        fromExpr(node.left)
        return fromExpr(node.right)
      case "unary":
        return fromExpr(node.operand)
      case "template":
        node.exprs.forEach(fromExpr)
        return
      case "cond":
        fromExpr(node.condition)
        fromExpr(node.then)
        return fromExpr(node.else)
      case "assign":
        fromExpr(node.target)
        return fromExpr(node.value)
      default:
        return assertNever(node)
    }
  }

  const fromBlock = (block: Block): void => {
    block.statements.forEach(fromStatement)
  }

  const fromStatement = (statement: Statement): void => {
    switch (statement.tag) {
      case "let-declaration":
      case "const-declaration":
        if (statement.expr !== undefined) fromExpr(statement.expr)
        return
      case "function-declaration":
        if (statement.body !== undefined) fromBlock(statement.body)
        return
      case "type-declaration":
      case "break":
      case "continue":
        return
      case "return":
      case "throw":
        return fromExpr(statement.value)
      case "expr-statement":
        return fromExpr(statement.expr)
      case "assign":
        return fromExpr(statement)
      case "if":
        statement.clauses.forEach((clause) => {
          fromExpr(clause.condition)
          fromBlock(clause.body)
        })
        if (statement.else !== null) fromBlock(statement.else)
        return
      case "while":
        fromExpr(statement.condition)
        return fromBlock(statement.body)
      case "for-of":
        fromExpr(statement.iterable)
        return fromBlock(statement.body)
      default:
        return assertNever(statement)
    }
  }

  statements.forEach(fromStatement)
  return [...found.values()]
}

export const programToBabel = (program: Program<unknown>): t.Program =>
  t.program(
    [
      ...collectImports(program.statements).map((binding) =>
        t.importDeclaration(
          [t.importNamespaceSpecifier(ident(binding.local, `import from "${binding.source}"`))],
          t.stringLiteral(binding.source),
        )
      ),
      ...program.statements.map(statementToBabel),
    ],
    [],
    "module",
  )

export const emitProgram = (program: Program<unknown>): string => generate(programToBabel(program)).code
