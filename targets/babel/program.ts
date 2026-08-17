import { generate } from "@babel/generator"
import * as t from "@babel/types"

import { collectImports } from "../../src/emit/imports.ts"
import { collectBindingNames } from "../../src/emit/names.ts"
import type { Program } from "../../src/program.ts"
import { ident } from "./shared.ts"
import { statementToBabel } from "./statement.ts"
export const programToBabel = (program: Program<unknown>): t.Program => {
  const names = collectBindingNames(program.statements)
  return t.program(
    [
      ...collectImports(program.statements).map((binding) =>
        t.importDeclaration(
          [t.importNamespaceSpecifier(ident(binding.local, `import from "${binding.source}"`))],
          t.stringLiteral(binding.source),
        )
      ),
      ...program.statements.map((statement) => statementToBabel(statement, names)),
    ],
    [],
    "module",
  )
}

export const emitProgram = (program: Program<unknown>): string => generate(programToBabel(program)).code
