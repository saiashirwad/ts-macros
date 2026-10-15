import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

export const typecheck = (sources: readonly string[]): string => {
  const dir = mkdtempSync(resolve(".denotation-stage2-"))
  try {
    const files = sources.map((source, index) => {
      const file = join(dir, `program${index}.ts`)
      writeFileSync(file, `${source}\nexport {}\n`)
      return file
    })
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--exactOptionalPropertyTypes",
        "--target",
        "esnext",
        "--types",
        "",
        "--pretty",
        "false",
        ...files,
      ],
      { encoding: "utf8", timeout: 120_000 },
    )
    if (result.error) throw result.error
    return `${result.stdout}${result.stderr}`.replaceAll(`${basename(dir)}/`, "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
