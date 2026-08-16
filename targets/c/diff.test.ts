import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import * as arithmetic from "../../examples/diff/arithmetic.ts"
import * as breakContinue from "../../examples/diff/break-continue.ts"
import * as classify from "../../examples/diff/classify.ts"
import * as comparisons from "../../examples/diff/comparisons.ts"
import * as divisionLiterals from "../../examples/diff/division-literals.ts"
import * as division from "../../examples/diff/division.ts"
import * as factorial from "../../examples/diff/factorial.ts"
import * as fib from "../../examples/diff/fib.ts"
import * as gcd from "../../examples/diff/gcd.ts"
import * as modulo from "../../examples/diff/modulo.ts"
import * as mutualRecursion from "../../examples/diff/mutual-recursion.ts"
import * as primes from "../../examples/diff/primes.ts"
import { emitProgramTypeScript } from "../typescript/index.ts"
import { emitProgramC } from "./index.ts"

const seeds = {
  arithmetic: { program: arithmetic.program, expected: "40" },
  "break-continue": { program: breakContinue.program, expected: "37" },
  classify: { program: classify.program, expected: "14" },
  comparisons: { program: comparisons.program, expected: "11" },
  division: { program: division.program, expected: "12" },
  "division-literals": { program: divisionLiterals.program, expected: "3.75" },
  factorial: { program: factorial.program, expected: "362880" },
  fib: { program: fib.program, expected: "6765" },
  gcd: { program: gcd.program, expected: "21" },
  modulo: { program: modulo.program, expected: "4" },
  "mutual-recursion": { program: mutualRecursion.program, expected: "10" },
  primes: { program: primes.program, expected: "8" },
} as const

const tsDriver = (source: string): string => `${source}\nconsole.log(probe());\n`

const cDriver = (source: string): string =>
  `#include <stdio.h>\n#include <stdbool.h>\n\n${source}\n\nint main(void){ printf("%g\\n", (double)probe()); return 0; }\n`

const tsEnv: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" }
delete tsEnv.NO_COLOR

interface Ran {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error: Error | undefined
}

const run = (command: string, args: string[], env: NodeJS.ProcessEnv | undefined = undefined): Ran => {
  const result = spawnSync(command, args, { encoding: "utf8", ...(env === undefined ? {} : { env }) })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error ?? undefined }
}

for (const [name, { program, expected }] of Object.entries(seeds)) {
  test(`diff: ${name} agrees across TS and C (${expected})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-macros-diff-"))
    try {
      const tsSource = tsDriver(emitProgramTypeScript(program))
      const tsFile = join(dir, "probe.ts")
      writeFileSync(tsFile, tsSource)
      const ts = run("npx", ["tsx", tsFile], tsEnv)

      const cSource = cDriver(emitProgramC(program))
      const cFile = join(dir, "probe.c")
      const binary = join(dir, "probe")
      writeFileSync(cFile, cSource)
      const compile = run("cc", ["-std=c11", "-Wall", "-Werror", cFile, "-o", binary])
      if (compile.error !== undefined) return

      assert.equal(ts.error, undefined, `tsx failed to start for ${name}: ${ts.error?.message}`)
      assert.equal(compile.status, 0, `cc failed to compile ${name}:\n${compile.stderr}\n--- C source ---\n${cSource}`)
      assert.equal(
        ts.status,
        0,
        `${name}: TS probe exited ${ts.status}:\n${ts.stderr}\n--- TS source ---\n${tsSource}`,
      )
      const c = run(binary, [])
      assert.equal(
        c.status,
        0,
        `${name}: C probe exited ${c.status}:\n${c.stderr}\n--- C source ---\n${cSource}`,
      )
      assert.equal(
        ts.stdout.trim(),
        expected,
        `${name}: TS probe disagrees with expected value (${expected}):\n${ts.stdout}`,
      )
      assert.equal(
        c.stdout.trim(),
        expected,
        `${name}: C probe disagrees with expected value (${expected}):\n${c.stdout}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
