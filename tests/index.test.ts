import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { cases } from "./exactness.ts"
import { expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("array reads include undefined without weakening array writes", () => {
  const read = Expr.index(Expr.array(1), 0)
  expectTypeOf<Expr.Denotes<typeof read>>().toEqualTypeOf<number | undefined>()
  assert.deepEqual(read.type, Type.union(Type.number, Type.undefined))
  Program.build(function*() {
    const xs = yield* Decl.const("xs", [1])
    yield* Stmt.assign(Expr.index(xs, 0), 2)
    // @ts-expect-error the read's undefined alternative is not a valid array element write
    Stmt.assign(Expr.index(xs, 0), FFI.Value<undefined>("undefined"))
    return xs
  })
})

test("tuple reads keep known positions and include undefined for dynamic positions", () => {
  Program.build(function*() {
    const tuple = yield* Decl.let("tuple", Type.tuple(Type.number, Type.string))
    const first = Expr.index(tuple, 0)
    expectTypeOf<Expr.Denotes<typeof first>>().toEqualTypeOf<number>()
    assert.equal(first.type, Type.number)
    const dynamic = Expr.index(tuple, FFI.Value<number>("indexValue"))
    expectTypeOf<Expr.Denotes<typeof dynamic>>().toEqualTypeOf<number | string | undefined>()
    assert.deepEqual(dynamic.type, Type.union(Type.number, Type.string, Type.undefined))
    // @ts-expect-error known tuple indices remain range-checked
    Expr.index(tuple, 2)
    // @ts-expect-error a dynamic read's undefined does not weaken writes
    Stmt.assign(dynamic, FFI.Value<undefined>("undefined"))
    return tuple
  })
})

test("tuple reads and writes use the index's declared literal type", () => {
  const exact: Equal<Expr.Denotes<typeof cases.tupleBoundIndex.program.result>, (tuple: [number, string]) => number> = true
  void [exact]
  const declaration = cases.tupleBoundIndex.program.statements[0] as Decl.BuiltFunction
  assert.equal(declaration.type?.return, Type.number)
  Program.build(function*() {
    const tuple = yield* Decl.let("tuple", Type.tuple(Type.number, Type.string))
    const zero = yield* Decl.const("zero", 0)
    yield* Stmt.assign(Expr.index(tuple, zero), 1)
    // @ts-expect-error a literal-typed reference selects the number position for writes too
    Stmt.assign(Expr.index(tuple, zero), "x")
    const outside = yield* Decl.const("outside", 2)
    // @ts-expect-error literal-typed references are range-checked
    Expr.index(tuple, outside)
    return tuple
  })
  const union = cases.tupleUnionIndex.program.statements[0] as Decl.BuiltFunction
  assert.deepEqual(union.type?.return, Type.union(Type.number, Type.string))
})
