import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type * as Expr from "../expr.ts"
import type { Program } from "../program.ts"
import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"
import { ident, statementToBabel } from "./typescript.ts"

export interface ImportBinding {
  readonly local: string
  readonly source: string
}

export const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()
  walk(statements, (node) => {
    if (node.tag !== "var-ref") return
    const { name, source } = node as Expr.VarRef<any, any>
    if (source === undefined) return
    const key = `${source} ${name}`
    if (!found.has(key)) found.set(key, { local: name, source })
  })
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
