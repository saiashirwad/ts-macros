# FIXES — cross-target differential suite (vision P2)

One fix, one commit, on `fix/diff`. Pure addition: 9 new files, zero lines touched
anywhere else.

## WHAT

Before: the only cross-target runtime check is `targets/c/dsa.test.ts`, a single
program that prints through the `printf` FFI — it can only run as C, so nothing
proves that two targets agree on semantics.

After: `examples/diff/` holds 8 seed programs; `targets/c/diff.test.ts` emits TS and C
from the **same** `Program` object, runs both, and requires identical stdout, exit
code 0, and a hand-computed expected value.

## The harness contract

- A seed exports one `Program` containing a nullary function `probe` that returns a
  small integer-valued number. Seeds are print-free; the harness appends the only
  per-target code:

  - TS driver: `console.log(probe());`
  - C driver: `#include <stdio.h>` + `#include <stdbool.h>` +
    `int main(void){ printf("%g\n", probe()); return 0; }`
    (`stdbool.h` because boolean bindings render as `bool`)

- The TS probe runs under `process.execPath` (bun, when the suite runs under
  `bun test`); the C probe compiles with `cc -std=c11 -Wall -Werror` and runs as a
  binary. `-Werror` means the emitted C must be warning-clean, not just compilable.
- The comparison is byte-exact on stdout plus exit code 0. On mismatch the assertion
  message carries both outputs, a minimal LCS line diff (`-` TS-only, `+` C-only),
  and both emitted sources.
- The `expected` table pins hand-computed values, so the suite catches a bug that
  both targets share, not just a disagreement between them.
- Two environment facts are load-bearing: bun colorizes `console.log` numbers, so
  the TS child runs with `FORCE_COLOR=0` and `NO_COLOR` removed (bun warns when
  both are set); and `%d` would be undefined behavior here because `number` renders
  as `double` in C — `%g` agrees with `console.log` only for integer-valued numbers
  with at most 6 significant digits inside roughly `[1e-4, 1e6)`, which is why
  every seed returns a small integer-valued number by construction.

## What the suite pins

| seed                              | pins                                                                    | probe returns |
| --------------------------------- | ----------------------------------------------------------------------- | ------------- |
| `examples/diff/arithmetic.ts`     | operator precedence and parentheses                                     | `40`          |
| `examples/diff/comparisons.ts`    | all six numeric comparisons, boolean logic, boolean bindings and params | `11`          |
| `examples/diff/classify.ts`       | if/elseif/else chains inside a counted while loop                       | `14`          |
| `examples/diff/factorial.ts`      | while-loop accumulation and call results feeding arithmetic             | `362880`      |
| `examples/diff/fib.ts`            | recursion, early returns, calls in argument position                    | `6765`        |
| `examples/diff/gcd.ts`            | reassigned params and if/else inside while                              | `21`          |
| `examples/diff/break-continue.ts` | break and continue inside while                                         | `37`          |
| `examples/diff/primes.ts`         | nested whiles and early boolean returns feeding conditions              | `8`           |

## Divergences avoided — the semantics-layer gap list

Each of these is a place where TS and C genuinely differ (or the IR cannot express
the construct); the seeds are written around them, and a future seed must respect
the same list.

1. **Integer division.** TS `/` is float division; C truncates when both operands
   are `int`. Today the shared subset has no int type at all — `Int` lives in
   `targets/c` and leaks the name `Int` into TS output — so `number`/`double`
   division would agree on both sides. Seeds still avoid `/`: the moment a
   portable int type lands (vision P3), a division seed would silently flip
   meaning. Add a division probe together with that numeric layer.
2. **`===` on strings.** The C target spells `===` as `==`, which compares pointers
   for `const char *`, not contents. Seeds use `===` on numbers only and contain
   no strings at all.
3. **Operand evaluation order.** C leaves the order of binary operands unspecified;
   TS is strict left-to-right. Seeds never put side effects inside expressions —
   assignments are standalone statements.
4. **Boolean output rendering.** TS prints `true`/`false`, C prints `1`/`0`.
   Probes return numbers; booleans only flow as conditions, params, and results
   consumed by conditions.
5. **Modulo.** The IR has no `%` operator, so parity/divisibility cannot be
   written. `primes.ts` simulates division-by-subtraction loops instead.
6. **C has no prototype hoisting.** A callee must be declared before its caller in
   the emitted C (TS hoists function declarations). Every seed orders callees
   first; self-recursion is fine. Mutual recursion is unexpressible in C today.
7. **Array literals are invalid C.** A binding initialized with an array literal
   renders as `double *xs = {...}` — a scalar initializer, rejected by cc. The C
   story for arrays is `malloc`/`Owned`, which the TS side cannot run. Arrays are
   excluded from seeds until both targets have a shared array type.
8. **`%g` formatting window.** See the harness contract: probe values must stay
   integer-valued with at most 6 significant digits.
9. **Eager bodies (vision P4).** A function's body materializes when its
   declaration is yielded, before the `yield*` ref exists — so a self-call cannot
   use the JS binding (`ReferenceError` in its TDZ). `fib.ts` works around it with
   a name-based `$.Value<(n: number) => number>("fib")` ref. Lazy bodies would
   delete the workaround.

## How to grow the suite

- **A new target reuses the same seeds and expected values unchanged.** Write
  `emitProgramX` + a driver line, add an entry to the harness, done. CUDA slots in
  the same way: kernels return `void` and are not probe-shaped, so the seeds stay
  host code and the probe remains a plain function.
- **A new seed** must use only the agreed subset (arithmetic, precedence, all six
  numeric comparisons, `&&`/`||`/`!`, `if`/`elseif`/`else`, `while`, calls,
  returns including early returns, booleans), declare callees before callers, keep
  the probe nullary and integer-valued (6 significant digits), and add its
  hand-computed value to the `expected` table. No imports, `for-of`, template
  literals, object/array literals, `Owned`, ternaries, or `/`.
- **When the numeric layer lands (vision P3):** add int-typed seeds with division
  and modulo, and the C driver can move back to `%d`.

## API change

None. Tests and examples only; no src/ or targets/c API touched.

## Files

### targets/c/diff.test.ts

```text
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
```

### examples/diff/arithmetic.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins operator precedence and parentheses: probe() must return 40 on every target
export const program = Program.build(function*() {
  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const a = yield* $.Const("a", $.add($.Number(1), $.mul($.Number(2), $.Number(3))))
      const b = yield* $.Const("b", $.mul($.add($.Number(1), $.Number(2)), $.Number(3)))
      const c = yield* $.Const("c", $.mul($.sub($.sub($.Number(10), $.Number(2)), $.Number(3)), $.add($.Number(4), $.Number(1))))
      return $.sub($.add($.add(a, b), c), $.Number(1))
    }),
  )
})
```

### examples/diff/comparisons.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins numeric comparisons, boolean logic, boolean bindings and params: probe() must return 11 on every target
export const program = Program.build(function*() {
  const bump = yield* $.Function("bump").pipe(
    $.Params($.Param("x", Type.Number()), $.Param("flag", Type.Boolean())),
    $.Returns(Type.Number()),
    $.Impl(function*({ x, flag }) {
      yield* $.If(flag, function*() {
        yield* $.Return($.add(x, $.Number(1)))
      })
      return $.sub(x, $.Number(1))
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const a = yield* $.Const("a", $.Number(3))
      const b = yield* $.Const("b", $.Number(7))
      const c = yield* $.Const("c", $.Number(3))
      const count = yield* $.Let("count", $.Number(0))
      yield* $.If($.eq(a, c), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.neq(a, b), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.lt(a, b), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.gt(b, a), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.lte(a, c), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.gte(b, a), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.and($.lt(a, b), $.lt(b, $.Number(10))), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.not($.gt(a, b)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.or($.gt(a, b), $.lt(a, b)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      const flag = yield* $.Const("flag", $.lt(a, b))
      yield* $.If($.and(flag, $.gt(b, a)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      return bump(count, flag)
    }),
  )
})
```

### examples/diff/classify.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins if/elseif/else chains inside a counted while loop: probe() must return 14 on every target
export const program = Program.build(function*() {
  const classify = yield* $.Function("classify").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      const result = yield* $.Let("result", $.Number(0))
      yield* $.If($.lt(n, $.Number(10)), function*() {
        yield* $.Assign(result, $.Number(1))
      }).elseif($.lt(n, $.Number(100)), function*() {
        yield* $.Assign(result, $.Number(2))
      }).else(function*() {
        yield* $.Assign(result, $.Number(3))
      })
      return result
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const total = yield* $.Let("total", $.Number(0))
      const i = yield* $.Let("i", $.Number(0))
      yield* $.While($.lt(i, $.Number(12)), function*() {
        yield* $.Assign(total, $.add(total, classify(i)))
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return total
    }),
  )
})
```

### examples/diff/factorial.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins while-loop accumulation and call results feeding arithmetic: probe() must return 362880 on every target
export const program = Program.build(function*() {
  const fact = yield* $.Function("fact").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      const result = yield* $.Let("result", $.Number(1))
      const i = yield* $.Let("i", $.Number(1))
      yield* $.While($.lte(i, n), function*() {
        yield* $.Assign(result, $.mul(result, i))
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return result
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return fact($.Number(9))
    }),
  )
})
```

### examples/diff/fib.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins recursion, early returns and calls in argument position: probe() must return 6765 on every target.
// Bodies materialize eagerly, so a self-call cannot use the yield* ref (the JS binding does not exist
// yet while the body drains) — it uses a name-based ref instead.
export const program = Program.build(function*() {
  const fibRef = $.Value<(n: number) => number>("fib")

  yield* $.Function("fib").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      yield* $.If($.lt(n, $.Number(2)), function*() {
        yield* $.Return(n)
      })
      return $.add($.Call(fibRef, $.sub(n, $.Number(1))), $.Call(fibRef, $.sub(n, $.Number(2))))
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return $.Call(fibRef, $.Number(20))
    }),
  )
})
```

### examples/diff/gcd.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins reassigned params and if/else inside while: probe() must return 21 on every target
export const program = Program.build(function*() {
  const gcd = yield* $.Function("gcd").pipe(
    $.Params($.Param("a", Type.Number()), $.Param("b", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ a, b }) {
      yield* $.While($.neq(a, b), function*() {
        yield* $.If($.gt(a, b), function*() {
          yield* $.Assign(a, $.sub(a, b))
        }).else(function*() {
          yield* $.Assign(b, $.sub(b, a))
        })
      })
      return a
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return gcd($.Number(252), $.Number(105))
    }),
  )
})
```

### examples/diff/break-continue.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins break and continue inside while: probe() must return 37 on every target
export const program = Program.build(function*() {
  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const sum = yield* $.Let("sum", $.Number(0))
      const i = yield* $.Let("i", $.Number(0))
      yield* $.While($.lt(i, $.Number(12)), function*() {
        yield* $.Assign(i, $.add(i, $.Number(1)))
        yield* $.If($.or($.eq(i, $.Number(3)), $.eq(i, $.Number(5))), function*() {
          yield* $.Continue()
        })
        yield* $.Assign(sum, $.add(sum, i))
        yield* $.If($.gt(sum, $.Number(30)), function*() {
          yield* $.Break()
        })
      })
      return sum
    }),
  )
})
```

### examples/diff/primes.ts

```text
import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins early returns, nested whiles and boolean results feeding conditions: probe() must return 8 on every target
// (divisibility is simulated with subtraction — the IR has no modulo operator)
export const program = Program.build(function*() {
  const isPrime = yield* $.Function("is_prime").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Boolean()),
    $.Impl(function*({ n }) {
      yield* $.If($.lt(n, $.Number(2)), function*() {
        yield* $.Return($.Boolean(false))
      })
      const i = yield* $.Let("i", $.Number(2))
      yield* $.While($.lt(i, n), function*() {
        const r = yield* $.Let("r", n)
        yield* $.While($.gte(r, i), function*() {
          yield* $.Assign(r, $.sub(r, i))
        })
        yield* $.If($.eq(r, $.Number(0)), function*() {
          yield* $.Return($.Boolean(false))
        })
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return $.Boolean(true)
    }),
  )

  const countPrimes = yield* $.Function("count_primes").pipe(
    $.Params($.Param("upto", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ upto }) {
      const count = yield* $.Let("count", $.Number(0))
      const i = yield* $.Let("i", $.Number(2))
      yield* $.While($.lt(i, upto), function*() {
        yield* $.If(isPrime(i), function*() {
          yield* $.Assign(count, $.add(count, $.Number(1)))
        })
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return count
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return countPrimes($.Number(20))
    }),
  )
})
```

## Verification

- `bun test`: 122 pass / 10 files (114 baseline + 8 diff tests)
- `./node_modules/.bin/tsc --noEmit`: clean
- `./node_modules/.bin/dprint check`: clean
