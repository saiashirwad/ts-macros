import { generate } from "@babel/generator"
import * as t from "@babel/types"

import type { Program } from "../program.ts"
import type { Statement } from "../statement.ts"
import { makeEmit } from "./target.ts"
import { traversal } from "./traversal.ts"
import { ident, statementToBabel } from "./typescript.ts"

interface ImportBinding {
  readonly local: string
  readonly source: string
}

const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()
  const emit = makeEmit({
    ...traversal,
    expr: {
      ...traversal.expr,
      "var-ref": (node) => {
        if (node.source === undefined) return
        const key = `${node.source} ${node.name}`
        if (!found.has(key)) found.set(key, { local: node.name, source: node.source })
      },
    },
  })
  statements.forEach(emit.statement)
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
