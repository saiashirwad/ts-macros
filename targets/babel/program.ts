import { generate } from "@babel/generator"
import * as t from "@babel/types"

import { collectImports } from "../../src/emit/imports.ts"
import { collectBindingNames } from "../../src/emit/names.ts"
import { makeEmit } from "../../src/emit/target.ts"
import type { Program } from "../../src/program.ts"
import { ident } from "./shared.ts"
import { babel } from "./target.ts"

export const programToBabel = (program: Program<unknown>): t.Program => {
  const emit = makeEmit(babel, collectBindingNames(program.statements))
  return t.program(
    [
      ...collectImports(program.statements).map((binding) =>
        t.importDeclaration(
          [t.importNamespaceSpecifier(ident(binding.local, `import from "${binding.source}"`))],
          t.stringLiteral(binding.source),
        )
      ),
      ...program.statements.map(emit.statement),
    ],
    [],
    "module",
  )
}

export const emitProgram = (program: Program<unknown>): string => generate(programToBabel(program)).code
