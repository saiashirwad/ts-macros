import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import type { CostReport, Metrics } from "../tools/type-profile.ts"

const root = resolve(import.meta.dirname, "..")
const run = (tool: string, args: string[], cwd: string = root) =>
  spawnSync(process.execPath, [join(root, "tools", tool), ...args], { cwd, encoding: "utf8", timeout: 30_000 })
const metrics = { files: 1, types: 2, instantiations: 3, memoryBytes: 4096, memoryAllocs: 5, checkSeconds: 0.1, totalSeconds: 0.2 } satisfies Metrics
const raw = "Files: 1\nTypes: 2\nInstantiations: 3\nMemory used: 4K\nMemory allocs: 5\nCheck time: 0.1s\nTotal time: 0.2s\n"
const report = {
  schemaVersion: 1,
  revision: "fixture",
  dirty: false,
  sourceHash: "source",
  lockfileHash: "lock",
  compilerVersion: "Version 7.0.2",
  nodeVersion: process.version,
  machine: { platform: "fixture" },
  config: {},
  compilerFlags: [],
  manifest: ["fixture.ts"],
  samples: Array.from({ length: 5 }, () => ({ elapsedSeconds: 0.3, loadBefore: [0, 0, 0], loadAfter: [0, 0, 0], metrics: { ...metrics }, raw })),
  summary: {
    files: { median: 1, min: 1, max: 1 },
    types: { median: 2, min: 2, max: 2 },
    instantiations: { median: 3, min: 3, max: 3 },
    memoryBytes: { median: 4096, min: 4096, max: 4096 },
    memoryAllocs: { median: 5, min: 5, max: 5 },
    checkSeconds: { median: 0.1, min: 0.1, max: 0.1 },
    totalSeconds: { median: 0.2, min: 0.2, max: 0.2 },
    elapsedSeconds: { median: 0.3, min: 0.3, max: 0.3 },
  },
} satisfies CostReport

test("cost comparison rejects counters and summaries that contradict raw compiler output", () => {
  const dir = mkdtempSync(join(root, ".denotation-cost-"))
  try {
    const base = join(dir, "base.json")
    const head = join(dir, "head.json")
    writeFileSync(base, JSON.stringify(report))
    writeFileSync(head, JSON.stringify(report))
    const valid = run("type-profile.ts", ["--compare", base, head])
    assert.equal(valid.error, undefined)
    assert.equal(valid.status, 0, valid.stderr)
    assert.match(valid.stdout, /Compatible workloads/)

    for (const key of ["instantiations", "checkSeconds"] as const) {
      const forged = structuredClone(report)
      for (const sample of forged.samples) sample.metrics[key] *= 2
      for (const field of ["median", "min", "max"] as const) forged.summary[key][field] *= 2
      writeFileSync(head, JSON.stringify(forged))
      const result = run("type-profile.ts", ["--compare", base, head])
      assert.equal(result.error, undefined)
      assert.notEqual(result.status, 0, `${key}: contradictory compiler evidence was accepted\n${result.stdout}`)
      assert.match(result.stderr, /metrics.*raw compiler output/)
    }

    const changedRaw = structuredClone(report)
    const firstSample = changedRaw.samples[0]
    assert.ok(firstSample)
    firstSample.raw = raw.replace("Instantiations: 3", "Instantiations: 6")
    writeFileSync(head, JSON.stringify(changedRaw))
    const result = run("type-profile.ts", ["--compare", base, head])
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0, `changed raw compiler evidence was accepted\n${result.stdout}`)
    assert.match(result.stderr, /metrics do not match raw compiler output/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("type degradation controls reject extra diagnostics with an otherwise accepted error code", () => {
  const dir = mkdtempSync(join(root, ".denotation-verifier-"))
  try {
    mkdirSync(join(dir, "tests"))
    for (const name of ["src", "targets", "node_modules"]) symlinkSync(join(root, name), join(dir, name), "dir")
    for (const name of ["typing.ts", "consumer-emission.ts"]) symlinkSync(join(root, "tests", name), join(dir, "tests", name))
    writeFileSync(join(dir, "tsconfig.json"), readFileSync(join(root, "tsconfig.json")))
    const source = readFileSync(join(root, "tests", "consumer-contract.test.ts"), "utf8")
    const anchor = "    void savedIdExact"
    assert.equal(source.split(anchor).length, 2)
    writeFileSync(
      join(dir, "tests", "consumer-contract.test.ts"),
      source.replace(anchor, `${anchor}\n    const unexpected: SavedId = true\n    void unexpected`),
    )
    const result = run("type-contracts.ts", [], dir)
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0, `extra TS2322 diagnostic was accepted\n${result.stdout}`)
    assert.match(result.stderr, /Id-any.*(?:unrelated|unexpected|diagnostics)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
