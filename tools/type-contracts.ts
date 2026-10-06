import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const fixture = readFileSync("tests/consumer-contract.test.ts", "utf8")
const replaceOne = (source: string, original: string, replacement: string): string => {
  assert.equal(source.split(original).length, 2, `seed must match once: ${original}`)
  return source.replace(original, replacement)
}
type ExpectedDiagnostic = { location: string; code: number }
type MutationSeed = { id: string; original: string; replacement: string; diagnostics: ExpectedDiagnostic[] }
type CompilerDiagnostic = { file: string | undefined; line: string | undefined; code: string }

const seeds: MutationSeed[] = [
  ...["Id", "Tree"].flatMap((name) =>
    ["any", "never"].map((type) => ({
      id: `${name}-${type}`,
      original: `$.const("saved${name}", ${name === "Id" ? "id" : "tree"})`,
      replacement: `$.const("saved${name}", $.hostValue<${type}>("input"))`,
      diagnostics: [{ location: `assertType<Equal<$.Denotes<typeof saved${name}>, ${name}>>()`, code: 2344 }],
    }))
  ),
  {
    id: "brand-to-string",
    original: "type Id = string & { readonly __brand: \"Id\" }",
    replacement: "type Id = string",
    diagnostics: [{ location: "// @ts-expect-error a plain string cannot satisfy a branded identifier", code: 2578 }],
  },
]
const dir = mkdtempSync(resolve(".denotation-contracts-"))
let succeeded = false
try {
  const config = join(dir, "tsconfig.json")
  writeFileSync(
    config,
    JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: { composite: false, incremental: false, declaration: false },
      files: ["contract.ts"],
      include: [],
      exclude: [],
    }),
  )
  for (const seed of [null, ...seeds]) {
    const source = (seed === null ? fixture : replaceOne(fixture, seed.original, seed.replacement))
      .replaceAll("from \"./typing.ts\"", "from \"../tests/typing.ts\"")
      .replaceAll("from \"./consumer-emission.ts\"", "from \"../tests/consumer-emission.ts\"")
    writeFileSync(join(dir, "contract.ts"), source)
    const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", config, "--pretty", "false"], {
      encoding: "utf8",
      timeout: 120_000,
    })
    if (result.error) throw result.error
    const output = `${result.stdout}${result.stderr}`
    if (seed === null) {
      assert.equal(result.status, 0, `unchanged control failed\n${output}`)
    } else {
      const expected = seed.diagnostics.map(({ location, code }) => {
        assert.equal(source.split(location).length, 2, `${seed.id} assertion location must match once: ${location}`)
        const line = source.slice(0, source.indexOf(location)).split("\n").length
        return `${join(dir, "contract.ts")}:${line}:TS${code}`
      }).sort()
      assert.equal(result.status, 1, `${seed.id} must fail compilation\n${output}`)
      const diagnostics = [...output.matchAll(/^(?:(.+)\((\d+),\d+\): )?error TS(\d+):/gm)]
        .map((match): CompilerDiagnostic => {
          const code = match[3]
          assert.ok(code, "compiler diagnostic requires a code")
          return { file: match[1], line: match[2], code }
        })
        .map(({ file, line, code }) => `${file ? resolve(file) : "<global>"}:${line ?? 0}:TS${code}`)
        .sort()
      assert.deepEqual(diagnostics, expected, `${seed.id} caused unexpected diagnostics\n${output}`)
      console.log(`Detected ${seed.id} at its expected diagnostic contracts`)
    }
  }
  succeeded = true
} finally {
  if (succeeded) rmSync(dir, { recursive: true, force: true })
  else console.error(`Retained failed control source at ${dir}`)
}
