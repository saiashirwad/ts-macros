import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { program } from "../examples/typed-construction.ts"
import { emitProgram } from "../targets/ts.ts"

test("the README shows the typed construction example and its unchanged emission", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const example = readFileSync(new URL("../examples/typed-construction.ts", import.meta.url), "utf8")
    .replace("\"../src/index.ts\"", "\"ts-macros\"")
    .replace("\"../targets/ts.ts\"", "\"ts-macros/targets/ts\"")
    .replace("export const program", "const program")
  const first = readme.match(/```ts\n([\s\S]*?)\n```/)
  const second = readme.match(/```text\n([\s\S]*?)\n```/)
  assert.equal(first?.[1], example.trimEnd())
  assert.equal(second?.[1], emitProgram(program))
})
