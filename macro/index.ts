// A macro module ends with `export const { a, b } = exports(program)`, where
// the program's body returned `{ a, b }` as references. Consumers import `a`
// and `b` typed as their denotations, computed by tsc from stage 1 alone; what
// runs is the code stage 1 emitted. Without the loader in `./register.ts`,
// `exports` evaluates that code in place.

import { stripTypeScriptTypes } from "node:module"
import type { Guard } from "../src/check.ts"
import type { Expr } from "../src/index.ts"
import type { Program } from "../src/program.ts"
import { bindingNames } from "../src/scope.ts"
import { emitProgram } from "../targets/typescript/index.ts"

type Exported = Readonly<Record<string, Expr.Ref<any, any, any, any>>>

export type Exports<A extends Exported> = { readonly [K in keyof A]: Expr.Denotes<A[K]> }

// A generic function denotes a description of its signature, and tsc cannot
// build `<T>(value: T) => T` from one, so its export would carry a wrong type.
type GenericKeys<A extends Exported> = { [K in keyof A]: A[K] extends Expr.Ref<Expr.GenericSignature, any, any, any> ? K : never }[keyof A]

type CheckExports<A extends Exported> = [GenericKeys<A>] extends [never] ? []
  : ["a generic function cannot be exported with its exact type", GenericKeys<A>]

const exportedNames = (program: Program<Exported>): [key: string, name: string][] => {
  const names = bindingNames(program.statements)
  return Object.entries(program.result).map(([key, ref]) => {
    const name = names.get(ref.id)
    if (name === undefined) throw new Error(`exported "${key}" is not declared at the top level of the program`)
    return [key, name]
  })
}

export const emitModule = (program: Program<Exported>): string => {
  const specifiers = exportedNames(program).map(([key, name]) => name === key ? key : `${name} as ${key}`)
  return `${emitProgram(program)}\nexport { ${specifiers.join(", ")} };\n`
}

declare global {
  /** set by the loader while it runs stage 1 to collect a module's emission */
  var __tsMacrosCapture: string[] | undefined
}

export const exports = <A extends Exported>(program: Program<A> & Guard<CheckExports<A>>): Exports<A> => {
  const captured = globalThis.__tsMacrosCapture
  if (captured !== undefined) {
    captured.push(emitModule(program))
    // SAFETY: under the loader this module is replaced by the emitted code before anyone imports these values
    return {} as Exports<A>
  }
  const fields = exportedNames(program).map(([key, name]) => `${key}: ${name}`)
  const js = stripTypeScriptTypes(emitProgram(program))
  if (/^import /m.test(js)) throw new Error("a macro module with imports needs the loader: node --import ts-macros/macro/register")
  // SAFETY: the emitted declarations denote exactly `Exports<A>`; tests/macro.test.ts checks this against tsc
  return new Function(`${js}\nreturn { ${fields.join(", ")} };`)() as Exports<A>
}
