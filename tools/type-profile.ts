import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { arch, cpus, loadavg, platform, release } from "node:os"
import { dirname, resolve } from "node:path"
import { performance } from "node:perf_hooks"

export type Metrics = {
  files: number
  types: number
  instantiations: number
  memoryBytes: number
  memoryAllocs: number
  checkSeconds: number
  totalSeconds: number
}
type Sample = {
  elapsedSeconds: number
  loadBefore: number[]
  loadAfter: number[]
  metrics: Metrics
  raw: string
}
type MetricSummary = { median: number; min: number; max: number }
export type Summary = Record<keyof Metrics | "elapsedSeconds", MetricSummary>
export type CostReport = {
  schemaVersion: 1
  collectedAt?: string
  revision: string
  dirty: unknown
  compilerVersion: string
  nodeVersion: string
  machine: unknown
  compilerFlags: unknown
  config: unknown
  manifest: unknown[]
  lockfileHash: string
  sourceHash: string
  samples: Sample[]
  summary: Summary
}
type CollectedReport = Omit<CostReport, "machine" | "config" | "compilerFlags" | "manifest" | "dirty"> & {
  dirty: boolean
  machine: { platform: string; arch: string; release: string; cpuModel: string | undefined; cpuCount: number }
  config: { compilerOptions: Record<string, unknown>; include: string[]; exclude: string[] }
  compilerFlags: string[]
  manifest: string[]
}
type Collection = { cwd: string; compiler: string; report: Omit<CollectedReport, "summary"> }

const args = process.argv.slice(2)
const compilerFlags = [
  "--noEmit",
  "--incremental",
  "false",
  "--composite",
  "false",
  "--declaration",
  "false",
  "--extendedDiagnostics",
  "--pretty",
  "false",
]
const fields = {
  files: ["Files", 1],
  types: ["Types", 1],
  instantiations: ["Instantiations", 1],
  memoryBytes: ["Memory used", 1024],
  memoryAllocs: ["Memory allocs", 1],
  checkSeconds: ["Check time", 1],
  totalSeconds: ["Total time", 1],
} satisfies Record<keyof Metrics, readonly [string, number]>
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex")
const run = (cmd: string, argv: string[], cwd: string) => {
  const result = spawnSync(cmd, argv, { cwd, encoding: "utf8", timeout: 120_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `command failed: ${cmd} ${argv.join(" ")}\n${result.stdout}${result.stderr}`)
  return result.stdout
}
const save = (file: string, value: CostReport) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
const record = (value: unknown, message: string): Record<string, unknown> => {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
  assert.ok(isRecord(value), message)
  return value
}
const nonemptyString = (value: unknown, message: string): string => {
  assert.ok(typeof value === "string", message)
  assert.match(value, /[\s\S]+/, message)
  return value
}
const prepare = (cwd: string): Collection => {
  const compiler = resolve(cwd, "node_modules/typescript/bin/tsc")
  const compilerVersion = run(process.execPath, [compiler, "--version"], cwd).trim()
  const rawConfig: unknown = JSON.parse(run(process.execPath, [compiler, "--showConfig"], cwd))
  const config = record(rawConfig, "invalid compiler configuration")
  assert.ok(Array.isArray(config.files), "compiler manifest must be an array")
  const manifest = config.files.map((file: unknown) => {
    assert.ok(typeof file === "string", "compiler manifest file must be a string")
    return file.replaceAll("\\", "/").replace(/^\.\//, "")
  }).sort()
  assert.ok(manifest.length > 0, "compiler manifest must not be empty")
  const sourceHash = hash(manifest.map((file) => `${file}\n${hash(readFileSync(resolve(cwd, file)))}`).join("\n"))
  const stringList = (value: unknown): string[] => {
    assert.ok(Array.isArray(value), "compiler configuration list must be an array")
    return value.map((item: unknown) => {
      assert.ok(typeof item === "string", "compiler configuration list entry must be a string")
      return item
    })
  }
  const configIdentity = {
    compilerOptions: record(config.compilerOptions, "invalid compiler options"),
    include: stringList(config.include ?? []),
    exclude: stringList(config.exclude ?? []),
  }
  return {
    cwd,
    compiler,
    report: {
      schemaVersion: 1,
      collectedAt: new Date().toISOString(),
      revision: run("git", ["rev-parse", "HEAD"], cwd).trim(),
      dirty: run("git", ["status", "--porcelain", "--untracked-files=normal"], cwd).trim().length > 0,
      compilerVersion,
      nodeVersion: process.version,
      machine: { platform: platform(), arch: arch(), release: release(), cpuModel: cpus()[0]?.model, cpuCount: cpus().length },
      compilerFlags,
      config: configIdentity,
      manifest,
      lockfileHash: hash(readFileSync(resolve(cwd, "pnpm-lock.yaml"))),
      sourceHash,
      samples: [],
    },
  }
}
const metricKeys = ["files", "types", "instantiations", "memoryBytes", "memoryAllocs", "checkSeconds", "totalSeconds"] as const
const summaryKeys = [...metricKeys, "elapsedSeconds"] as const
const parseMetrics = (raw: string): Metrics => {
  const metrics: Metrics = { files: 0, types: 0, instantiations: 0, memoryBytes: 0, memoryAllocs: 0, checkSeconds: 0, totalSeconds: 0 }
  for (const key of metricKeys) {
    const [label, factor] = fields[key]
    const match = raw.match(new RegExp(`^${label}:\\s+([\\d.]+)([Ks]?)\\s*$`, "m"))
    assert.ok(match, `missing compiler metric ${label}\n${raw}`)
    const value = Number(match[1]) * factor
    assert.ok(Number.isFinite(value) && value >= 0, `invalid compiler metric ${label}`)
    metrics[key] = value
  }
  assert.ok(metrics.files > 0 && metrics.instantiations > 0 && metrics.checkSeconds > 0, "cold compilation must do typechecking work")
  return metrics
}
const sample = ({ cwd, compiler, report }: Collection) => {
  const loadBefore = loadavg()
  const start = performance.now()
  const raw = run(process.execPath, [compiler, ...compilerFlags], cwd)
  const metrics = parseMetrics(raw)
  report.samples.push({ elapsedSeconds: (performance.now() - start) / 1000, loadBefore, loadAfter: loadavg(), metrics, raw })
}
const summarize = <Report extends Omit<CostReport, "summary">>(report: Report): Report & { summary: Summary } => {
  const metricSummary = (key: keyof Summary): MetricSummary => {
    const values = report.samples.map((row) => key === "elapsedSeconds" ? row.elapsedSeconds : row.metrics[key]).sort((a, b) => a - b)
    const min = values[0]
    const max = values.at(-1)
    const lower = values[Math.floor((values.length - 1) / 2)]
    const upper = values[Math.floor(values.length / 2)]
    assert.ok(lower !== undefined && upper !== undefined && min !== undefined && max !== undefined, "cost report requires samples")
    const median = lower + (upper - lower) / 2
    return { median, min, max }
  }
  return {
    ...report,
    summary: {
      files: metricSummary("files"),
      types: metricSummary("types"),
      instantiations: metricSummary("instantiations"),
      memoryBytes: metricSummary("memoryBytes"),
      memoryAllocs: metricSummary("memoryAllocs"),
      checkSeconds: metricSummary("checkSeconds"),
      totalSeconds: metricSummary("totalSeconds"),
      elapsedSeconds: metricSummary("elapsedSeconds"),
    },
  }
}
const readReport = (file: string): CostReport => {
  const json: unknown = JSON.parse(readFileSync(file, "utf8"))
  const report = record(json, "invalid cost report")
  assert.equal(report.schemaVersion, 1, "unsupported cost report")
  assert.ok(Array.isArray(report.samples) && report.samples.length >= 5, "cost report requires at least five samples")
  const compilerVersion = nonemptyString(report.compilerVersion, "missing report compilerVersion")
  const nodeVersion = nonemptyString(report.nodeVersion, "missing report nodeVersion")
  const lockfileHash = nonemptyString(report.lockfileHash, "missing report lockfileHash")
  const revision = nonemptyString(report.revision, "missing report revision")
  const sourceHash = nonemptyString(report.sourceHash, "missing report sourceHash")
  assert.ok(Array.isArray(report.manifest) && report.manifest.length > 0, "missing workload manifest")
  for (const key of ["machine", "config", "compilerFlags", "summary"]) assert.ok(report[key], `missing report ${key}`)
  const summary = record(report.summary, "invalid report summary")
  for (const key of summaryKeys) {
    const stats = record(summary[key], `invalid summary ${key}`)
    for (const field of ["median", "min", "max"]) assert.ok(Number.isFinite(stats[field]), `invalid summary ${key}.${field}`)
  }
  const samples = report.samples.map((value: unknown): Sample => {
    const sample = record(value, "invalid compiler sample")
    const elapsedSeconds = sample.elapsedSeconds
    assert.ok(typeof elapsedSeconds === "number" && Number.isFinite(elapsedSeconds) && elapsedSeconds > 0, "invalid elapsed compiler time")
    const load = (name: "loadBefore" | "loadAfter"): number[] => {
      const values = sample[name]
      assert.ok(Array.isArray(values) && values.length === 3, `invalid sample ${name}`)
      return values.map((value: unknown) => {
        assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0, `invalid sample ${name}`)
        return value
      })
    }
    const loadBefore = load("loadBefore")
    const loadAfter = load("loadAfter")
    const raw = nonemptyString(sample.raw, "missing raw compiler output")
    const metrics = parseMetrics(raw)
    assert.deepEqual(sample.metrics, metrics, "metrics do not match raw compiler output")
    return { elapsedSeconds, loadBefore, loadAfter, metrics, raw }
  })
  const parsed = summarize({
    schemaVersion: 1,
    compilerVersion,
    nodeVersion,
    lockfileHash,
    revision,
    sourceHash,
    dirty: report.dirty,
    machine: report.machine,
    config: report.config,
    compilerFlags: report.compilerFlags,
    manifest: report.manifest,
    samples,
  })
  assert.deepEqual(report.summary, parsed.summary, "summary does not match raw samples")
  return parsed
}
const compare = (base: CostReport, head: CostReport) => {
  const dimensions: (keyof CostReport)[] = ["compilerVersion", "nodeVersion", "machine", "compilerFlags", "config", "manifest", "lockfileHash"]
  const reasons = dimensions.filter((key) => JSON.stringify(base[key]) !== JSON.stringify(head[key]))
  const lines = [
    "# Cold typecheck cost",
    "",
    `Base revision ${base.revision}${base.dirty ? " with local changes" : ""}.`,
    `Head revision ${head.revision}${head.dirty ? " with local changes" : ""}.`,
    "",
  ]
  if (reasons.length > 0) {
    lines.push(
      `Workloads are incomparable because these dimensions differ: ${reasons.join(", ")}.`,
      "Both raw reports remain available. No regression conclusion is drawn.",
    )
  } else {
    lines.push(
      `Compatible workloads, ${base.samples.length} base samples and ${head.samples.length} head samples.`,
      "",
      "| Metric | Base median [min, max] | Head median [min, max] | Median delta |",
      "|---|---:|---:|---:|",
    )
    for (const key of summaryKeys) {
      const a = base.summary[key]
      const b = head.summary[key]
      const delta = a.median === 0 ? "n/a" : `${((b.median / a.median - 1) * 100).toFixed(2)}%`
      lines.push(
        `| ${key} | ${a.median.toFixed(3)} [${a.min.toFixed(3)}, ${a.max.toFixed(3)}] | ${b.median.toFixed(3)} [${b.min.toFixed(3)}, ${
          b.max.toFixed(3)
        }] | ${delta} |`,
      )
    }
    lines.push(
      "",
      "Time and memory are observations with machine noise. These deltas do not identify a cause or establish a speedup.",
      "Source hashes identify measured inputs and may differ across compatible revisions. No timing threshold gates this report.",
    )
  }
  return `${lines.join("\n")}\n`
}

if (args[0] === "--compare") {
  assert.ok(args.length === 3 || args.length === 5 && args[3] === "--report", "usage: --compare BASE HEAD [--report FILE]")
  const baseFile = args[1]
  const headFile = args[2]
  assert.ok(baseFile !== undefined && headFile !== undefined, "comparison requires base and head reports")
  const text = compare(readReport(baseFile), readReport(headFile))
  console.log(text)
  if (args[3]) {
    const reportFile = args[4]
    assert.ok(reportFile !== undefined, "comparison requires report output")
    mkdirSync(dirname(reportFile), { recursive: true })
    writeFileSync(reportFile, text)
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
} else {
  const options = new Map<string, string>()
  assert.equal(args.length % 2, 0, "flags require values")
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    assert.ok(flag !== undefined && value !== undefined, "flags require values")
    assert.ok(["--cwd", "--output", "--baseline-cwd", "--baseline-output"].includes(flag), `unknown flag ${flag}`)
    assert.ok(!options.has(flag), `duplicate flag ${flag}`)
    options.set(flag, value)
  }
  assert.equal(options.has("--baseline-cwd"), options.has("--baseline-output"), "baseline requires cwd and output")
  const output = resolve(options.get("--output") ?? ".cache/typecheck/head.json")
  const baselineOutput = options.get("--baseline-output")
  const baselineCwd = options.get("--baseline-cwd")
  if (baselineOutput !== undefined) assert.notEqual(resolve(baselineOutput), output, "baseline and head outputs must differ")
  const head = prepare(resolve(options.get("--cwd") ?? "."))
  const base = baselineCwd !== undefined ? prepare(resolve(baselineCwd)) : undefined
  for (let i = 0; i < 5; i++) {
    if (base) sample(base)
    sample(head)
  }
  save(output, summarize(head.report))
  console.log(`Saved five cold compiler samples to ${output}`)
  if (base) {
    assert.ok(baselineOutput !== undefined, "baseline requires output")
    const baseOutput = resolve(baselineOutput)
    save(baseOutput, summarize(base.report))
    console.log(`Saved five alternating baseline samples to ${baseOutput}`)
  }
}
