import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"

import { emitModule } from "../macro/index.ts"
import * as kinds from "./kinds.macro.ts"

const TSC = join(process.cwd(), "node_modules", ".bin", "tsc")
const names = Object.keys(kinds.exportable.result)

test("each macro export has exactly the type tsc infers for the emitted export", () => {
  const dir = mkdtempSync(resolve(".denotation-"))
  try {
    writeFileSync(join(dir, "emitted.ts"), emitModule(kinds.exportable))
    writeFileSync(
      join(dir, "check.ts"),
      [
        `import type * as Stage1 from "../tests/kinds.macro.ts";`,
        `import type * as Emitted from "./emitted.ts";`,
        `import type { Equal } from "../tests/typing.ts";`,
        `type Assert<T extends true> = T;`,
        ...names.map((name) => `type ${name} = Assert<Equal<typeof Stage1.${name}, typeof Emitted.${name}>>;`),
      ].join("\n"),
    )
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "../tsconfig.json",
        compilerOptions: { composite: false, incremental: false, declaration: false },
        files: ["check.ts", "emitted.ts"],
        include: [],
        exclude: [],
      }),
    )
    const tsc = spawnSync(TSC, ["-p", join(dir, "tsconfig.json"), "--noEmit", "--pretty", "false"], { encoding: "utf8" })
    assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}\n${emitModule(kinds.exportable)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const consumer = `
import { registerHooks } from "node:module"
const loaded = []
registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context) } })
const m = await import(${JSON.stringify(new URL("./kinds.macro.ts", import.meta.url).href)})
const values = { literal: m.literal, counter: m.counter, copy: m.copy, point: m.point, pick: m.pick(false), scaled: m.scaled(5) }
console.log(JSON.stringify({ stage1: loaded.some((url) => url.includes("/src/")), values }))
`

const run = (...flags: string[]) => {
  const node = spawnSync(process.execPath, [...flags, "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", consumer], {
    encoding: "utf8",
  })
  assert.equal(node.status, 0, node.stderr)
  return JSON.parse(node.stdout) as { stage1: boolean; values: unknown }
}

const expected = { literal: 1, counter: 1, copy: "a", point: { x: 1, y: [1, 2] }, pick: "no", scaled: 5 }

test("without the loader, a macro module runs stage 1 and evaluates its emission in place", () => {
  assert.deepEqual(run(), { stage1: true, values: expected })
})

test("with the loader, the consumer loads only the emitted module", () => {
  assert.deepEqual(run("--import", new URL("../macro/register.ts", import.meta.url).href), { stage1: false, values: expected })
})
