import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { source } from "../../examples/examples-c-dsa.ts"

test("the DSA program is real C: it compiles with cc and runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-macros-c-"))
  const file = join(dir, "dsa.c")
  const binary = join(dir, "dsa")
  writeFileSync(file, source)

  const compile = spawnSync("cc", ["-std=c11", "-Wall", "-Werror", file, "-o", binary], { encoding: "utf8" })
  if (compile.error !== undefined) return // no C compiler on this machine
  assert.equal(compile.status, 0, compile.stderr)

  const run = spawnSync(binary, [], { encoding: "utf8" })
  assert.equal(run.status, 0)
  assert.equal(run.stdout, "found at index 5\n")
})

test("the emitted DSA source frees its buffer after the last use", () => {
  const lines = source.split("\n").map((line) => line.trim())
  const freeAt = lines.indexOf("free(xs);", lines.indexOf("int main(void) {"))
  assert.notEqual(freeAt, -1)
  assert.equal(lines[freeAt - 1], "const int found = binary_search(xs, 10, 25);")
  assert.equal(lines[freeAt + 1], "printf(\"found at index %d\\n\", found);")
})
