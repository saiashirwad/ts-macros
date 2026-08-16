import { generate } from "@babel/generator"
import * as t from "@babel/types"

import { collectImports, type ImportBinding } from "../../src/emit/imports.ts"
import type { Program } from "../../src/program.ts"
import { ident } from "./shared.ts"
import { statementToBabel } from "./statement.ts"
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
