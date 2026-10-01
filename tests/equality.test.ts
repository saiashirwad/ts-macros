import assert from "node:assert/strict"
import { test } from "node:test"

import { cases } from "./equality.ts"
import { emittedTypecheck } from "./typing.ts"

test("equality follows tsc's comparable relation rather than whole-type assignability", () => {
  const diagnostics = emittedTypecheck(new URL("./equality.ts", import.meta.url), cases)
  assert.equal(diagnostics, "", diagnostics)
})
