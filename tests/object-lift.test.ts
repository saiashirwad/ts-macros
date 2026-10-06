import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"

const constructors = [$.lift<any>, $.object<any>]

test("object lifting rejects unsupported prototypes and descriptors consistently", () => {
  class RecordClass {
    value = 1
  }
  const prototypes = [new Date(), Object.create(null), new RecordClass(), Object.create({ inherited: 1 })]
  let reads = 0
  const accessor = Object.defineProperty({ visible: 1 }, "computed", {
    enumerable: true,
    get() {
      reads++
      return 2
    },
  })
  const invalidFields = [
    [{ visible: 1, [Symbol("hidden")]: 2 }, "fields must not have symbol keys"],
    [Object.defineProperty({ visible: 1 }, "hidden", { value: 2 }), "field \"hidden\" must be enumerable"],
    [accessor, "field \"computed\" must be a data property, not an accessor"],
  ] as const

  for (const construct of constructors) {
    for (const value of prototypes) {
      assert.throws(() => construct(value), { message: "fields must be a plain object literal with Object.prototype" })
    }
    for (const [value, message] of invalidFields) {
      assert.throws(() => construct(value), { message })
    }
  }
  assert.equal(reads, 0)
})

test("object lifting preserves structure, metadata, child identity, and own special keys", () => {
  const child = $.number(7)
  const input = Object.freeze({
    2: "two",
    1: "one",
    nested: { items: [child, { enabled: true }] },
    child,
    ["__proto__"]: "data",
  })
  const lifted = $.lift(input)
  const direct = $.object(input)

  assert.deepEqual(lifted, direct)
  assert.deepEqual(Object.keys(lifted.fields), ["1", "2", "nested", "child", "__proto__"])
  assert.equal(lifted.fields.child, child)
  assert.equal(lifted.fields.nested.fields.items.elements[0], child)
  assert.equal(lifted.fields.nested.kind, "object")
  assert.equal(lifted.fields.nested.fields.items.kind, "array")
  assert.equal(lifted.type?.kind, "object")
  assert.equal(lifted.fields.nested.type?.kind, "object")
  assert.equal(lifted.fields.nested.fields.items.type?.kind, "array")
  assert.equal(Object.getPrototypeOf(lifted.fields), Object.prototype)
  assert.equal(Object.hasOwn(lifted.fields, "__proto__"), true)
  assert.equal(lifted.fields.__proto__.value, "data")
})

test("object lifting validates every parent descriptor before lifting children", () => {
  let reads = 0
  const input = Object.defineProperty({ invalidChild: null }, "later", {
    enumerable: true,
    get() {
      reads++
      return 1
    },
  })
  for (const construct of constructors) {
    assert.throws(() => construct(input), { message: "field \"later\" must be a data property, not an accessor" })
  }
  assert.equal(reads, 0)
})
