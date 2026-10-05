import { test } from "node:test"

import { Expr, FFI, Stmt } from "../src/index.ts"
import type { Equal } from "./typing.ts"

test("lvalue write types are independent of their read types", () => {
  const optional = Expr.prop(FFI.Value<{ a?: number }>("optional"), "a")
  const explicit = Expr.prop(FFI.Value<{ a?: number | undefined }>("explicit"), "a")
  const tuple = Expr.index(FFI.Value<[number, string]>("tuple"), FFI.Value<0 | 1>("i"))
  const shared = Expr.index(FFI.Value<[number | string, number | boolean]>("shared"), FFI.Value<0 | 1>("i"))
  const reads: Equal<Expr.Denotes<typeof optional>, number | undefined> = true
  const writes: Equal<Stmt.WriteType<typeof optional>, number> = true
  const explicitWrite: Equal<Stmt.WriteType<typeof explicit>, number | undefined> = true
  const tupleRead: Equal<Expr.Denotes<typeof tuple>, number | string> = true
  const tupleWrite: Equal<Stmt.WriteType<typeof tuple>, never> = true
  const sharedWrite: Equal<Stmt.WriteType<typeof shared>, number> = true
  void [reads, writes, explicitWrite, tupleRead, tupleWrite, sharedWrite]
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
  const writes: Equal<Stmt.WriteType<typeof optional>, number> = true
  const explicitWrite: Equal<Stmt.WriteType<typeof explicit>, number | undefined> = true
  void [writes, explicitWrite]
  Stmt.assign(optional, 1)
  Stmt.assign(explicit, FFI.Value<undefined>("undefined"))
  // @ts-expect-error optional tuple reads do not determine their write type
  Stmt.assign(optional, FFI.Value<undefined>("undefined"))
})

test("property writes intersect keys after combining union receivers", () => {
  const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
  const obj = FFI.Value<{ a: number; b: string } | { a: string; b: number }>("obj")
  const target = Expr.prop(obj, key)
  const writes: Equal<Stmt.WriteType<typeof target>, number | string> = true
  void writes
  Stmt.assign(target, 1)
  Stmt.assign(target, "x")
  const single = Expr.prop(FFI.Value<{ a: number; b: string }>("single"), key)
  const disjoint: Equal<Stmt.WriteType<typeof single>, never> = true
  void disjoint
  // @ts-expect-error without a receiver union every key must accept the value
  Stmt.assign(single, 1)
  // @ts-expect-error boolean satisfies neither key on the union receiver
  Stmt.assign(target, true)
})
