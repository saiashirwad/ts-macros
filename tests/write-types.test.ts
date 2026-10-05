import { test } from "node:test"

import { Expr, FFI, Stmt } from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("lvalue write types are independent of their read types", () => {
  const optional = Expr.prop(FFI.Value<{ a?: number }>("optional"), "a")
  const explicit = Expr.prop(FFI.Value<{ a?: number | undefined }>("explicit"), "a")
  const tuple = Expr.index(FFI.Value<[number, string]>("tuple"), FFI.Value<0 | 1>("i"))
  const shared = Expr.index(FFI.Value<[number | string, number | boolean]>("shared"), FFI.Value<0 | 1>("i"))
  assertType<Equal<Expr.Denotes<typeof optional>, number | undefined>>()
  assertType<Equal<Stmt.WriteType<typeof optional>, number>>()
  assertType<Equal<Stmt.WriteType<typeof explicit>, number | undefined>>()
  assertType<Equal<Expr.Denotes<typeof tuple>, number | string>>()
  assertType<Equal<Stmt.WriteType<typeof tuple>, never>>()
  assertType<Equal<Stmt.WriteType<typeof shared>, number>>()
  Stmt.assign(optional, 1)
  Stmt.assign(explicit, FFI.Value<undefined>("undefined"))
  Stmt.assign(shared, 1)
  // @ts-expect-error implicit undefined is not a writable optional property value
  Stmt.assign(optional, FFI.Value<undefined>("undefined"))
  // @ts-expect-error string does not satisfy every possible position
  Stmt.assign(shared, "x")
})

test("optional tuple writes exclude only implicit undefined", () => {
  const optional = Expr.index(FFI.Value<[number?]>("tuple"), 0)
  const explicit = Expr.index(FFI.Value<[(number | undefined)?]>("tuple"), 0)
  assertType<Equal<Stmt.WriteType<typeof optional>, number>>()
  assertType<Equal<Stmt.WriteType<typeof explicit>, number | undefined>>()
  Stmt.assign(optional, 1)
  Stmt.assign(explicit, FFI.Value<undefined>("undefined"))
  // @ts-expect-error optional tuple reads do not determine their write type
  Stmt.assign(optional, FFI.Value<undefined>("undefined"))
})

test("property writes intersect keys after combining union receivers", () => {
  const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
  const obj = FFI.Value<{ a: number; b: string } | { a: string; b: number }>("obj")
  const target = Expr.prop(obj, key)
  assertType<Equal<Stmt.WriteType<typeof target>, number | string>>()
  Stmt.assign(target, 1)
  Stmt.assign(target, "x")
  const single = Expr.prop(FFI.Value<{ a: number; b: string }>("single"), key)
  assertType<Equal<Stmt.WriteType<typeof single>, never>>()
  // @ts-expect-error without a receiver union every key must accept the value
  Stmt.assign(single, 1)
  // @ts-expect-error boolean satisfies neither key on the union receiver
  Stmt.assign(target, true)
})
