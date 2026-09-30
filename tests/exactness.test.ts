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

test("raw object fields widen as mutable locations", () => {
  assert.deepEqual(rawObject.type?.fields.a, { kind: "primitive", name: "number" })
})
