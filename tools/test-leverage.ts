import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

const SOURCE_DIRS = ["src", "targets"]
const TREE = ["src", "targets", "tests", "examples", "tools", "README.md", "package.json", "tsconfig.json"]

interface Mutant {
  readonly id: string
  readonly file: string
  readonly offset: number
}

interface Catch {
  readonly mutant: string
  readonly caught: string[]
}

export interface LeverageReport {
  readonly schemaVersion: 1
  readonly mutants: Catch[]
  readonly survivors: string[]
}

const walk = (dir: string): string[] => {
  const found: string[] = []
  for (const entry of [...new Set(readdirSync(dir))].sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(full)
  }
  return found
}

/** Index just past the opening `{` of a block body, skipping strings, comments, and template holes. */
const bodyStart = (source: string, from: number, isFunction: boolean): number | undefined => {
  let parens = 0
  let braces = 0
  let brackets = 0
  let sawParams = !isFunction
  let sawArrow = false
  for (let i = from; i < source.length; i++) {
    const char = source[i]!
    const next = source[i + 1]
    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", i)
      if (newline === -1) return undefined
      i = newline
      continue
    }
    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", i)
      if (close === -1) return undefined
      i = close + 1
      continue
    }
    if (char === "\"" || char === "'" || char === "`") {
      const close = skipString(source, i)
      if (close === -1) return undefined
      i = close
      continue
    }
    if (char === "(") {
      parens++
      continue
    }
    if (char === ")") {
      parens--
      if (parens === 0) sawParams = true
      continue
    }
    if (char === "[") {
      brackets++
      continue
    }
    if (char === "]") {
      brackets--
      continue
    }
    if (char === "{") {
      if (braces === 0 && parens === 0 && brackets === 0 && sawParams && (isFunction || sawArrow)) return i + 1
      braces++
      continue
    }
    if (char === "}") {
      if (braces === 0 && parens === 0 && brackets === 0) return undefined
      braces--
      continue
    }
    if (parens !== 0 || braces !== 0 || brackets !== 0) continue
    if (char === "=" && next === ">") {
      sawArrow = true
      i++
      continue
    }
    if (char === ";") return undefined
  }
  return undefined
}

const skipString = (source: string, start: number): number => {
  const quote = source[start]
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++
      continue
    }
    if (source[i] === quote) return i
  }
  return -1
}

const enumerate = (): Mutant[] => {
  const mutants: Mutant[] = []
  const seen = new Set<string>()
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(resolve(root, dir))) {
      const source = readFileSync(file, "utf8")
      const relativePath = relative(root, file)
      const declaration = /^export (const|function) (\w+)/gm
      for (let match = declaration.exec(source); match !== null; match = declaration.exec(source)) {
        const id = `${relativePath}:${match[2]}`
        if (seen.has(id)) continue
        const offset = bodyStart(source, match.index, match[1] === "function")
        if (offset === undefined) continue
        seen.add(id)
        mutants.push({ id, file: relativePath, offset })
      }
    }
  }
  return mutants
}

const prepareScratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ts-macros-leverage-"))
  for (const entry of TREE) cpSync(join(root, entry), join(dir, entry), { recursive: true })
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir")
  return dir
}

const failingTests = (dir: string): string[] => {
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 600_000,
  })
  const output = `${run.stdout}${run.stderr}`
  return [...new Set([...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]!.trim()))].sort()
}

const runMutant = (scratch: string, mutant: Mutant): Catch => {
  const pristine = readFileSync(join(scratch, mutant.file), "utf8")
  const inject = `throw new Error(${JSON.stringify(`mutant ${mutant.id}`)});`
  try {
    writeFileSync(join(scratch, mutant.file), `${pristine.slice(0, mutant.offset)}${inject}${pristine.slice(mutant.offset)}`)
    return { mutant: mutant.id, caught: failingTests(scratch) }
  } finally {
    writeFileSync(join(scratch, mutant.file), pristine)
  }
}

const measure = (mutants: Mutant[]): LeverageReport => {
  const workers = Math.max(1, Math.min(availableParallelism() - 1, 8))
  const lanes: Mutant[][] = Array.from({ length: workers }, () => [])
  mutants.forEach((mutant, index) => lanes[index % workers]!.push(mutant))
  const results: Catch[] = []
  for (const lane of lanes) {
    const scratch = prepareScratch()
    try {
      for (const mutant of lane) results.push(runMutant(scratch, mutant))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  results.sort((left, right) => left.mutant.localeCompare(right.mutant))
  return {
    schemaVersion: 1,
    mutants: results,
    survivors: results.filter((result) => result.caught.length === 0).map((result) => result.mutant),
  }
}

interface Report {
  readonly mutants: Catch[]
  readonly survivors: string[]
}

const isReport = (value: unknown): value is Report => {
  if (Array.isArray(value) || value === null || typeof value !== "object") return false
  const { mutants, survivors } = value as Record<string, unknown>
  return Array.isArray(mutants) && mutants.every((entry) => Array.isArray(entry) && typeof entry[1] === "string")
    && Array.isArray(survivors) && survivors.every((entry) => typeof entry === "string")
}

const read = (path: string): Report => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isReport(parsed)) throw new Error(`${path} is not a leverage report`)
  return parsed
}

const compare = (basePath: string, headPath: string): void => {
  const base = read(basePath)
  const head = read(headPath)
  const before = new Map(base.mutants.map((entry) => [entry.mutant, new Set(entry.caught)]))
  const after = new Map(head.mutants.map((entry) => [entry.mutant, new Set(entry.caught)]))
  const lost: string[] = []
  const added: string[] = []
  for (const [mutant, caught] of before) {
    const now = after.get(mutant)
    if (now === undefined) {
      lost.push(`${mutant}: mutant no longer exists`)
      continue
    }
    for (const test of caught) if (!now.has(test)) lost.push(`${mutant}: ${test}`)
  }
  for (const mutant of after.keys()) if (!before.has(mutant)) added.push(mutant)
  console.log(`base: ${base.mutants.length} mutants, ${base.survivors.length} survivors`)
  console.log(`head: ${head.mutants.length} mutants, ${head.survivors.length} survivors`)
  if (added.length > 0) console.log(`\nnew mutants (${added.length}):\n${added.join("\n")}`)
  if (lost.length > 0) {
    console.log(`\nlost coverage (${lost.length}):\n${lost.join("\n")}`)
    process.exitCode = 1
    return
  }
  console.log("\nno mutant lost a test that caught it")
}

const main = (): void => {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`)
    return index === -1 ? undefined : args[index + 1]
  }
  if (args[0] === "--compare") {
    const [, , base, head] = args
    if (base === undefined || head === undefined) throw new Error("usage: --compare <base.json> <head.json>")
    compare(base, head)
    return
  }
  if (args[0] === "--list") {
    for (const mutant of enumerate()) console.log(mutant.id)
    return
  }
  const all = enumerate()
  const only = flag("only")
  const mutants = only === undefined ? all : all.filter((mutant) => mutant.id.includes(only))
  const out = flag("output")
  const report = measure(mutants)
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (out === undefined) process.stdout.write(json)
  else {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, json)
    console.log(`${mutants.length} mutants, ${report.survivors.length} survivors -> ${out}`)
    for (const survivor of report.survivors) console.log(`  survivor: ${survivor}`)
  }
}

main()
