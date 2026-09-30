import assert from "node:assert/strict"
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
  assert.equal(reads && writes && explicitWrite && tupleRead && tupleWrite && sharedWrite, true)
  Stmt.assign(optional, 1)
  Stmt.assign(explicit, FFI.Value<undefined>("undefined"))
  Stmt.assign(shared, 1)
  // @ts-expect-error implicit undefined is not a writable optional property value
  Stmt.assign(optional, FFI.Value<undefined>("undefined"))
  // @ts-expect-error string does not satisfy every possible position
  Stmt.assign(shared, "x")
})
