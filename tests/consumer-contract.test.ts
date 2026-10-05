import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { cases } from "./consumer-emission.ts"
import { emittedTypecheck } from "./typing.ts"
import type { Equal } from "./typing.ts"

type Assert<T extends true> = T

type AnyIsNotNumber = Assert<Equal<any, number> extends false ? true : false>
type NeverIsNotUnknown = Assert<Equal<never, unknown> extends false ? true : false>
type UnknownIsNotNumber = Assert<Equal<unknown, number> extends false ? true : false>
type LiteralIsNotWide = Assert<Equal<"draft", string> extends false ? true : false>
type UnionIsNotMember = Assert<Equal<"draft" | "done", "draft"> extends false ? true : false>
const controls: [AnyIsNotNumber, NeverIsNotUnknown, UnknownIsNotNumber, LiteralIsNotWide, UnionIsNotMember] = [true, true, true, true, true]
void controls

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

test("consumer operations keep declared, branded and recursive denotations usable", () => {
  const id = FFI.Value<Id>("id")
  const tree = FFI.Value<Tree>("tree")
  const program = Program.build(function*() {
    const savedId = yield* Decl.const("savedId", id)
    type SavedId = Assert<Equal<Expr.Denotes<typeof savedId>, Id>>
    const savedIdExact: SavedId = true
    void savedIdExact
    const savedTree = yield* Decl.const("savedTree", tree)
    type SavedTree = Assert<Equal<Expr.Denotes<typeof savedTree>, Tree>>
    const savedTreeExact: SavedTree = true
    void savedTreeExact
    const fresh = yield* Decl.const("fresh", "draft")
    type Fresh = Assert<Equal<Expr.Denotes<typeof fresh>, "draft">>
    const freshExact: Fresh = true
    void freshExact
    const takeId = FFI.Value<(value: Id) => number>("takeId")
    const takeTree = FFI.Value<(value: Tree) => number>("takeTree")
    const result = yield* Decl.const("result", Expr.add(Expr.call(takeId, savedId), Expr.call(takeTree, savedTree)))
    const status = yield* Decl.let("status", "draft", Type.union(Type.literal("draft"), Type.literal("done")))
    type Status = Assert<Equal<Expr.Denotes<typeof status>, "draft" | "done">>
    const statusExact: Status = true
    void statusExact
    yield* Stmt.assign(status, "done")
    return result
  })
  const result: Assert<Equal<Expr.Denotes<typeof program.result>, number>> = true
  assert.equal(result, true)
})

const rejectedConsumerOperations = () => {
  const id = FFI.Value<Id>("id")
  const takeId = FFI.Value<(value: Id) => number>("takeId")
  const tree = FFI.Value<Tree>("tree")
  Expr.call(takeId, id)
  // @ts-expect-error a plain string cannot satisfy a branded identifier
  Expr.call(takeId, "id")
  // @ts-expect-error unknown is not evidence of a branded identifier
  Expr.call(takeId, FFI.Value<unknown>("untrusted"))
  Expr.call(FFI.Value<(value: Tree) => number>("takeTree"), tree)
  // @ts-expect-error a recursive node must contain children of the same shape
  Expr.call(FFI.Value<(value: Tree) => number>("takeTree"), { value: 1, children: [{ value: "bad", children: [] }] })
  Program.build(function*() {
    const status = yield* Decl.let("status", "draft", Type.union(Type.literal("draft"), Type.literal("done")))
    yield* Stmt.assign(status, "done")
    // @ts-expect-error a third state is not a valid assignment
    yield* Stmt.assign(status, "deleted")
    const inferred = yield* Decl.const("inferred", "draft")
    const acceptsDraft = FFI.Value<(value: "draft") => void>("acceptsDraft")
    Expr.call(acceptsDraft, inferred)
    // @ts-expect-error the literal must not widen to arbitrary strings at the call site
    Expr.call(acceptsDraft, "done")
    return status
  })
}
void rejectedConsumerOperations

test("consumer denotations agree with unchanged emitted TypeScript", () => {
  assert.equal(emittedTypecheck(new URL("./consumer-emission.ts", import.meta.url), cases), "")
})
