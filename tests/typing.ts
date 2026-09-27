// Helpers for checking what the builders know about types.
//
// `typeOf(ref).is<A>()` is a compile-time assertion on a reference's phantom
// and a no-op at runtime, so it can sit inline in a program right after the
// `yield*` that produced the reference. `emittedTypecheck` covers the other
// side: it emits programs with every inferred type spelled out as an
// annotation and asks the TypeScript compiler whether the result holds up.

import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Block, block } from "../src/block.ts"
import type { Expr, Type } from "../src/index.ts"
import { makeStatement } from "../src/node.ts"
import type { Program } from "../src/program.ts"
import type { Statement } from "../src/statement.ts"
import { walk } from "../src/walk.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type Mismatch<Expected, Actual> = ["expected", Expected, "but the reference denotes", Actual]

export interface TypeChecks<E extends Expr.Expr<any>> {
  /** the reference denotes exactly `A` */
  is<A>(..._check: Equal<Expr.Denotes<E>, A> extends true ? [] : [Mismatch<A, Expr.Denotes<E>>]): TypeChecks<E>
  isMutable(..._check: E extends Expr.Ref<any, true, any> ? [] : ["expected an assignable binding"]): TypeChecks<E>
  isReadonly(..._check: E extends Expr.Ref<any, false, any> ? [] : ["expected a binding that rejects assignment"]): TypeChecks<E>
}

/** compile-time assertions about a reference's phantom; a no-op at runtime */
export const typeOf = <E extends Expr.Expr<any>>(_expr: E): TypeChecks<E> => {
  const checks: TypeChecks<E> = { is: () => checks, isMutable: () => checks, isReadonly: () => checks }
  return checks
}

/** a compile-time assertion that `T` is exactly `U`: `expectTypeOf<T>(null as any).toEqualTypeOf<U>()` */
export const expectTypeOf = <T>(_value: T) => ({
  toEqualTypeOf: <U>(..._check: Equal<T, U> extends true ? [] : ["Type mismatch"]) => {},
})

/** every binding and function annotated by its inferred type, where it has one and the user wrote none */
const annotated = (statements: ReadonlyArray<Statement<"built">>): Statement<"built">[] => {
  const annotateBlock = (root: Block<Statement<"built">>): Block<Statement<"built">> => block(root.statements.map(annotate))
  const annotate = (statement: Statement<"built">): Statement<"built"> => {
    switch (statement.kind) {
      case "let-declaration":
      case "const-declaration":
        return statement.annotation === undefined && statement.type !== undefined
          ? makeStatement({ ...statement, annotation: statement.type })
          : statement
      case "function-declaration": {
        const returnType = statement.returnType ?? (statement.type as Type.FunctionType | undefined)?.return
        return makeStatement({ ...statement, returnType, body: annotateBlock(statement.body) })
      }
      case "if":
        return makeStatement({
          ...statement,
          clauses: statement.clauses.map((clause) => ({ ...clause, body: annotateBlock(clause.body) })),
          else: statement.else === undefined ? undefined : annotateBlock(statement.else),
        })
      case "while":
      case "for-of":
        return makeStatement({ ...statement, body: annotateBlock(statement.body) })
      default:
        return statement
    }
  }
  return statements.map(annotate)
}

/** the program as TypeScript with every inferred type written out */
export const emittedSource = (program: Program<unknown>): string => emitProgram({ ...program, statements: annotated(program.statements) })

/** ambient declarations for the host values a program refers to, so the emitted file stands alone */
const ambient = (statements: ReadonlyArray<Statement>): string[] => {
  const values = new Set<string>()
  const modules = new Set<string>()
  walk(statements, (node) => {
    if (node.kind !== "external") return
    const external = node
    if (external.source !== undefined) modules.add(external.source)
    // globals the standard library already declares (JSON, Math, console) must not be redeclared
    else if (!(external.name in globalThis)) values.add(external.name)
  })
  return [
    ...[...modules].map((source) => `declare module ${JSON.stringify(source)};`),
    ...[...values].map((name) => `declare const ${name}: any;`),
  ]
}

const TSC = join(process.cwd(), "node_modules", ".bin", "tsc")

/**
 * Emits each program as TypeScript with its inferred types written out, then
 * typechecks all of them with `tsc --strict`. Returns the diagnostics, empty
 * when every program is sound.
 */
export const emittedTypecheck = (programs: { readonly [name: string]: Program<unknown> }): string => {
  const dir = mkdtempSync(join(tmpdir(), "ts-macros-typing-"))
  try {
    const files = Object.entries(programs).map(([name, program]) => {
      const source = `export {};\n${emittedSource(program)}`
      const file = join(dir, `${name}.ts`)
      writeFileSync(file, source)
      return { file, source }
    })
    // host values are declared once, globally, so every emitted file stands alone
    const ambientFile = join(dir, "ambient.d.ts")
    writeFileSync(ambientFile, [...new Set(Object.values(programs).flatMap((program) => ambient(program.statements)))].join("\n"))
    const tsc = spawnSync(TSC, [
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--ignoreConfig",
      "--target",
      "es2022",
      "--lib",
      "es2022",
      ambientFile,
      ...files.map((f) => f.file),
    ], {
      encoding: "utf8",
    })
    if (tsc.error !== undefined) throw tsc.error
    if (tsc.status === 0) return ""
    const sources = files.map((f) => `--- ${f.file}\n${f.source}`).join("\n")
    return `${tsc.stdout}${tsc.stderr}\n${sources}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
