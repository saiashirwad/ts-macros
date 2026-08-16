import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type * as Expr from "../expr.ts"
import type { Program } from "../program.ts"
import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"
import { ident } from "./shared.ts"
import { statementToBabel } from "./statement.ts"

interface ImportBinding {
  readonly local: string
  readonly source: string
}

const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()

  walk(statements, (node) => {
    if (node.tag === "var-ref") {
      const varRef = node as unknown as Expr.VarRef<any, any>
      if (varRef.source !== undefined) {
        const key = `${varRef.source} ${varRef.name}`
        if (!found.has(key)) found.set(key, { local: varRef.name, source: varRef.source })
      }
    }
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
