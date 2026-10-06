import { test } from "node:test"

import * as $ from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("lvalue write types are independent of their read types", () => {
  const optional = $.prop($.hostValue<{ a?: number }>("optional"), "a")
  const explicit = $.prop($.hostValue<{ a?: number | undefined }>("explicit"), "a")
  const tuple = $.index($.hostValue<[number, string]>("tuple"), $.hostValue<0 | 1>("i"))
  const shared = $.index($.hostValue<[number | string, number | boolean]>("shared"), $.hostValue<0 | 1>("i"))
  assertType<Equal<$.Denotes<typeof optional>, number | undefined>>()
  assertType<Equal<$.WriteType<typeof optional>, number>>()
  assertType<Equal<$.WriteType<typeof explicit>, number | undefined>>()
  assertType<Equal<$.Denotes<typeof tuple>, number | string>>()
  assertType<Equal<$.WriteType<typeof tuple>, never>>()
  assertType<Equal<$.WriteType<typeof shared>, number>>()
  $.assign(optional, 1)
  $.assign(explicit, $.hostValue<undefined>("undefined"))
  $.assign(shared, 1)
  // @ts-expect-error implicit undefined is not a writable optional property value
  $.assign(optional, $.hostValue<undefined>("undefined"))
  // @ts-expect-error string does not satisfy every possible position
  $.assign(shared, "x")
})

test("optional tuple writes exclude only implicit undefined", () => {
  const optional = $.index($.hostValue<[number?]>("tuple"), 0)
  const explicit = $.index($.hostValue<[(number | undefined)?]>("tuple"), 0)
  assertType<Equal<$.WriteType<typeof optional>, number>>()
  assertType<Equal<$.WriteType<typeof explicit>, number | undefined>>()
  $.assign(optional, 1)
  $.assign(explicit, $.hostValue<undefined>("undefined"))
  // @ts-expect-error optional tuple reads do not determine their write type
  $.assign(optional, $.hostValue<undefined>("undefined"))
})

test("property writes intersect keys after combining union receivers", () => {
  const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
  const obj = $.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj")
  const target = $.prop(obj, key)
  assertType<Equal<$.WriteType<typeof target>, number | string>>()
  $.assign(target, 1)
  $.assign(target, "x")
  const single = $.prop($.hostValue<{ a: number; b: string }>("single"), key)
  assertType<Equal<$.WriteType<typeof single>, never>>()
  // @ts-expect-error without a receiver union every key must accept the value
  $.assign(single, 1)
  // @ts-expect-error boolean satisfies neither key on the union receiver
  $.assign(target, true)
})
