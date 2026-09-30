import assert from "node:assert/strict"
import { test } from "node:test"

import { cases, emptyArray, rawObject } from "./exactness.ts"
import { emittedTypecheck } from "./typing.ts"

test("denotations equal unchanged stage-2 inference, with recorded divergences", () => {
  const diagnostics = emittedTypecheck(new URL("./exactness.ts", import.meta.url), cases)
  assert.equal(diagnostics, "", diagnostics)
})

test("recorded runtime divergence: empty arrays have no attached type (#31 item 7)", () => {
  assert.equal(emptyArray.type, undefined)
})

test("recorded raw-object divergence: fields have not widened (#31 item 4)", () => {
  assert.deepEqual(rawObject.type?.fields.a, { kind: "literal", value: 1 })
})
