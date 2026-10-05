import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { type Block, block } from "../src/block.ts"
import type { Expr, Type } from "../src/index.ts"
import { makeStatement } from "../src/node.ts"
import type { Program } from "../src/program.ts"
import { bindingNames } from "../src/scope.ts"
import type { Statement } from "../src/statement.ts"
import { emitProgram } from "../targets/ts.ts"

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

export const assertType = <_ extends true>() => {}

type Equivalent<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type Mismatch<Expected, Actual> = ["expected", Expected, "but the reference denotes", Actual]

export interface TypeChecks<E extends Expr.Expr<any>> {
  is<A>(..._check: Equivalent<Expr.Denotes<E>, A> extends true ? [] : [Mismatch<A, Expr.Denotes<E>>]): TypeChecks<E>
  isMutable(..._check: E extends Expr.Ref<any, true, any> ? [] : ["expected an assignable binding"]): TypeChecks<E>
  isReadonly(..._check: E extends Expr.Ref<any, false, any> ? [] : ["expected a binding that rejects assignment"]): TypeChecks<E>
}

export const typeOf = <E extends Expr.Expr<any>>(_expr: E): TypeChecks<E> => {
  const checks: TypeChecks<E> = { is: () => checks, isMutable: () => checks, isReadonly: () => checks }
  return checks
}

export const expectTypeOf = <T>(_value?: T) => ({
  toEqualTypeOf: <U>(..._check: Equivalent<T, U> extends true ? [] : ["Type mismatch"]) => {},
})

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

export const emittedSource = (program: Program<unknown>): string => emitProgram({ ...program, statements: annotated(program.statements) })

const TSC = join(process.cwd(), "node_modules", ".bin", "tsc")

export interface ExactCase {
  readonly program: Program<Expr.Ref<any, any, any>>
  readonly expression?: Expr.Expr<any>
  readonly ambient?: string
  readonly diagnostics?: readonly [number, ...number[]]
}

export const emittedTypecheck = (fixture: URL, cases: Readonly<Record<string, ExactCase>>): string => {
  for (const [name, row] of Object.entries(cases)) {
    if (row.diagnostics !== undefined && row.diagnostics.length === 0) {
      throw new Error(`case "${name}" must expect at least one diagnostic`)
    }
  }
  const dir = mkdtempSync(resolve(".denotation-"))
  try {
    const fixturePath = relative(dir, fileURLToPath(fixture))
    const checks: string[] = [
      `import type { cases } from ${JSON.stringify(fixturePath)};`,
      `import type { Expr } from '../src/index.ts';`,
      `import type { Equal } from '../tests/typing.ts';`,
      `type Assert<T extends true> = T;`,
      `type Reject<T extends false> = T;`,
      `type AnyControl = Reject<Equal<any, number>>;`,
      `type NeverControl = Reject<Equal<never, unknown>>;`,
      `type ReadonlyControl = Reject<Equal<{ readonly a: number }, { a: number }>>;`,
      `type OptionalControl = Reject<Equal<{ a?: number }, { a: number }>>;`,
      `type LiteralControl = Reject<Equal<1, number>>;`,
    ]
    const files = Object.entries(cases).map(([name, row]) => {
      const { program } = row
      const binding = bindingNames(program.statements).get(program.result.id)
      if (binding === undefined) throw new Error(`case "${name}" must return a declared binding`)
      const source = `${row.ambient ?? ""}\n${emitProgram(program)}\nexport { ${binding} };`
      const file = join(dir, `${name}.ts`)
      writeFileSync(file, source)
      if (row.diagnostics === undefined) {
        checks.push(
          `type ${name} = Assert<Equal<Expr.Denotes<typeof cases.${name}.${
            row.expression === undefined ? "program.result" : "expression"
          }>, typeof import('./${name}.ts').${binding}>>;`,
        )
      }
      return { file, source }
    })
    writeFileSync(join(dir, "check.ts"), checks.join("\n"))
    const config = join(dir, "tsconfig.json")
    writeFileSync(
      config,
      JSON.stringify({
        extends: "../tsconfig.json",
        compilerOptions: { composite: false, incremental: false, declaration: false },
        files: ["check.ts", ...Object.keys(cases).map((name) => `${name}.ts`)],
        include: [],
        exclude: [],
      }),
    )
    const tsc = spawnSync(TSC, ["-p", config, "--noEmit", "--pretty", "false"], { encoding: "utf8", timeout: 120_000 })
    if (tsc.error !== undefined) throw tsc.error
    const diagnostics = `${tsc.stdout}${tsc.stderr}`
    const expected = Object.entries(cases).flatMap(([name, row]) => (row.diagnostics ?? []).map((code) => `${name}.ts:${code}`)).sort()
    const actual = [...diagnostics.matchAll(/([^\s/]+\.ts)\(\d+,\d+\): error TS(\d+):/g)].map((match) => `${match[1]}:${match[2]}`).sort()
    if (JSON.stringify(actual) === JSON.stringify(expected) && tsc.status === (expected.length === 0 ? 0 : 1)) return ""
    const sources = files.map((f) => `--- ${f.file}\n${f.source}`).join("\n")
    return `${diagnostics}\nexpected diagnostics: ${expected.join(", ")}\n${checks.join("\n")}\n${sources}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
