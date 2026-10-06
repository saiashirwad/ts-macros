import { test } from "node:test"

import * as T from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("lvalue write types are independent of their read types", () => {
  const optional = T.prop(T.hostValue<{ a?: number }>("optional"), "a")
  const explicit = T.prop(T.hostValue<{ a?: number | undefined }>("explicit"), "a")
  const tuple = T.index(T.hostValue<[number, string]>("tuple"), T.hostValue<0 | 1>("i"))
  const shared = T.index(T.hostValue<[number | string, number | boolean]>("shared"), T.hostValue<0 | 1>("i"))
  assertType<Equal<T.Denotes<typeof optional>, number | undefined>>()
  assertType<Equal<T.WriteType<typeof optional>, number>>()
  assertType<Equal<T.WriteType<typeof explicit>, number | undefined>>()
  assertType<Equal<T.Denotes<typeof tuple>, number | string>>()
  assertType<Equal<T.WriteType<typeof tuple>, never>>()
  assertType<Equal<T.WriteType<typeof shared>, number>>()
  T.assign(optional, 1)
  T.assign(explicit, T.hostValue<undefined>("undefined"))
  T.assign(shared, 1)
  // @ts-expect-error implicit undefined is not a writable optional property value
  T.assign(optional, T.hostValue<undefined>("undefined"))
  // @ts-expect-error string does not satisfy every possible position
  T.assign(shared, "x")
})

test("optional tuple writes exclude only implicit undefined", () => {
  const optional = T.index(T.hostValue<[number?]>("tuple"), 0)
  const explicit = T.index(T.hostValue<[(number | undefined)?]>("tuple"), 0)
  assertType<Equal<T.WriteType<typeof optional>, number>>()
  assertType<Equal<T.WriteType<typeof explicit>, number | undefined>>()
  T.assign(optional, 1)
  T.assign(explicit, T.hostValue<undefined>("undefined"))
  // @ts-expect-error optional tuple reads do not determine their write type
  T.assign(optional, T.hostValue<undefined>("undefined"))
})

test("property writes intersect keys after combining union receivers", () => {
  const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
  const obj = T.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj")
  const target = T.prop(obj, key)
  assertType<Equal<T.WriteType<typeof target>, number | string>>()
  T.assign(target, 1)
  T.assign(target, "x")
  const single = T.prop(T.hostValue<{ a: number; b: string }>("single"), key)
  assertType<Equal<T.WriteType<typeof single>, never>>()
  // @ts-expect-error without a receiver union every key must accept the value
  T.assign(single, 1)
  // @ts-expect-error boolean satisfies neither key on the union receiver
  T.assign(target, true)
})
