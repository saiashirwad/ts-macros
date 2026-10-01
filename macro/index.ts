// Prototype: importing staged programs from ordinary code.
//
// A macro module ends with `export const { a, b } = exports(program)`, where
// the program's body returned `{ a, b }` as references. Consumers import `a`
// and `b` by name. Their types are the denotations, computed by tsc from stage
// 1 alone; what runs is the code stage 1 emitted, which has those types.
//
// Without the loader in `./register.ts`, `exports` emits and evaluates the
// program itself. With it, the module is replaced by the emitted code before
// anything runs, and stage 1 never runs in the consumer's process.

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

/** the emitted program, ending in one `export` that names each result reference by its key */
export const emitModule = (program: Program<Exported>): string => {
  const names = bindingNames(program.statements)
  const specifiers = Object.entries(program.result).map(([key, ref]) => {
    const name = names.get(ref.id)
    if (name === undefined) throw new Error(`exported "${key}" is not declared at the top level of the program`)
    return name === key ? key : `${name} as ${key}`
  })
  return `${emitProgram(program)}\nexport { ${specifiers.join(", ")} };\n`
}

/** set by the loader while it runs stage 1 to collect a module's emission */
export const CAPTURE = "__tsMacrosCapture"

declare global {
  var __tsMacrosCapture: string[] | undefined
}

export const exports = <A extends Exported>(program: Program<A> & Guard<CheckExports<A>>): Exports<A> => {
  const source = emitModule(program)
  const captured = globalThis[CAPTURE]
  if (captured !== undefined) {
    captured.push(source)
    // SAFETY: under the loader this module is replaced by `source` before anyone imports these values
    return {} as Exports<A>
  }
  return evaluate<A>(source)
}

/** runs an emitted module in place; only a module with no imports can run this way */
const evaluate = <A extends Exported>(source: string): Exports<A> => {
  const js = stripTypeScriptTypes(source)
  if (/^import /m.test(js)) throw new Error("a macro module with imports needs the loader: node --import ts-macros/macro/register")
  const body = js.replace(/^export \{ (.*) \};$/m, (_, specifiers: string) => {
    const fields = specifiers.split(", ").map((specifier) => {
      const [local, exported = local] = specifier.split(" as ")
      return `${exported}: ${local}`
    })
    return `return { ${fields.join(", ")} };`
  })
  // SAFETY: the emitted declarations denote exactly `Exports<A>`; tests/macro.test.ts checks this against tsc
  return new Function(body)() as Exports<A>
}
