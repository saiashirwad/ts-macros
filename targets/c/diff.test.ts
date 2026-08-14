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
import * as factorial from "../../examples/diff/factorial.ts"
import * as fib from "../../examples/diff/fib.ts"
import * as gcd from "../../examples/diff/gcd.ts"
import * as primes from "../../examples/diff/primes.ts"
import { emitProgramText } from "../../src/emit/index.ts"
import { emitProgramC } from "./index.ts"

// Every seed exports one Program whose nullary function "probe" returns a
// small integer-valued number. The same Program object goes through both
// emitters; the drivers below are the only per-target code. "expected" is
// hand-computed, so the suite catches a bug that both targets share, not
// just a disagreement between them.
const seeds = {
  arithmetic: { program: arithmetic.program, expected: "40" },
  "break-continue": { program: breakContinue.program, expected: "37" },
  classify: { program: classify.program, expected: "14" },
  comparisons: { program: comparisons.program, expected: "11" },
  factorial: { program: factorial.program, expected: "362880" },
  fib: { program: fib.program, expected: "6765" },
  gcd: { program: gcd.program, expected: "21" },
  primes: { program: primes.program, expected: "8" },
} as const

// number renders as double in C, so the C driver prints with %g, which
// agrees with console.log only for integer-valued numbers within roughly
// [1e-4, 1e6) at 6 significant digits — the seeds guarantee that by
// construction (small operands, no division)
const tsDriver = (source: string): string => `${source}\nconsole.log(probe());\n`

const cDriver = (source: string): string =>
  `#include <stdio.h>\n#include <stdbool.h>\n\n${source}\n\nint main(void){ printf("%g\\n", probe()); return 0; }\n`

// bun colorizes console.log numbers when it believes a terminal is watching;
// force plain output so the byte comparison is meaningful (NO_COLOR is removed,
// not set: bun warns when both variables are present)
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

// minimal LCS line diff; "-" lines are TS-only, "+" lines are C-only
const lineDiff = (expected: string, actual: string): string => {
  const a = expected.split("\n")
  const b = actual.split("\n")
  const table: number[][] = Array.from({ length: b.length + 1 }, () => new Array<number>(a.length + 1).fill(0))
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      table[i]![j] = a[j - 1] === b[i - 1] ? table[i - 1]![j - 1]! + 1 : Math.max(table[i - 1]![j]!, table[i]![j - 1]!)
    }
  }
  const lines: string[] = []
  let i = b.length
  let j = a.length
  while (i > 0 && j > 0) {
    if (a[j - 1] === b[i - 1]) {
      lines.push(`  ${a[j - 1]}`)
      i--
      j--
    } else if (table[i - 1]![j]! >= table[i]![j - 1]!) {
      lines.push(`+ ${b[i - 1]}`)
      i--
    } else {
      lines.push(`- ${a[j - 1]}`)
      j--
    }
  }
  while (i > 0) {
    lines.push(`+ ${b[i - 1]}`)
    i--
  }
  while (j > 0) {
    lines.push(`- ${a[j - 1]}`)
    j--
  }
  return lines.reverse().join("\n")
}

for (const [name, { program, expected }] of Object.entries(seeds)) {
  test(`diff: ${name} agrees across TS and C (${expected})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-macros-diff-"))
    try {
      const tsSource = tsDriver(emitProgramText(program))
      const tsFile = join(dir, "probe.ts")
      writeFileSync(tsFile, tsSource)
      const ts = run(process.execPath, [tsFile], tsEnv)

      const cSource = cDriver(emitProgramC(program))
      const cFile = join(dir, "probe.c")
      const binary = join(dir, "probe")
      writeFileSync(cFile, cSource)
      const compile = run("cc", ["-std=c11", "-Wall", "-Werror", cFile, "-o", binary])
      if (compile.error !== undefined) return // no C compiler on this machine

      assert.equal(ts.error, undefined, `bun failed to start for ${name}: ${ts.error?.message}`)
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
        ts.stdout,
        `${expected}\n`,
        `${name}: probe disagrees with its hand-computed value\nTS stdout:\n${ts.stdout}\nC stdout:\n${c.stdout}`,
      )
      assert.equal(
        c.stdout,
        ts.stdout,
        `${name}: TS and C disagree\n\nTS (bun, exit ${ts.status}):\n${ts.stdout}\nC (cc, exit ${c.status}):\n${c.stdout}\n\noutput diff (TS - / C +):\n${
          lineDiff(ts.stdout, c.stdout)
        }\n\n--- TS source ---\n${tsSource}\n\n--- C source ---\n${cSource}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
