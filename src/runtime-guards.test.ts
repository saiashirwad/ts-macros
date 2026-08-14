import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { emitProgram, emitProgramText, makeEmit, text } from "./emit/index.ts"
import { Value } from "./ffi.ts"
import { makeYieldable, stagingError } from "./pipeable.ts"
import * as Program from "./program.ts"
import { texpr } from "./sugar/tsugar.ts"
import * as Type from "./types/index.ts"

test("a node coerced by a JS operator throws a staging error naming the sugar", () => {
  const x: any = Value<number>("x")
  assert.throws(() => x > 3, /staging error: a var-ref node escaped into a JavaScript operator/)
  assert.throws(() => x > 3, /sugar functions \(add, sub, gt, \.\.\.\)/)
  assert.throws(() => x > 3, /\$\.expr/)
  assert.throws(() => x + 1, /staging error/)
  assert.throws(() => String(x), /staging error/)
})

test("typed nodes are rejected by the operator at compile time", () => {
  const x = Value<number>("x")
  if (false) {
    // @ts-expect-error JS operators run at metaprogram time; TS rejects them on typed nodes
    x > 3
  }
})

test("yieldable nodes inherit the throwing toPrimitive from Prototype", () => {
  const x: any = makeYieldable({ tag: "var-ref", name: "x" })
  assert.throws(() => x * 2, /staging error: a var-ref node/)
  assert.throws(() => x[Symbol.toPrimitive](), /staging error/)
})

test("stagingError is exported and names the node's tag", () => {
  assert.throws(() => stagingError({ tag: "prop", object: null, key: "k" }), /staging error: a prop node/)
})

test("surface proxies throw the staging error instead of bun's No default value", () => {
  const fs = $.import_("node:fs")
  assert.throws(() => String(fs), /staging error: a var-ref node/)
  assert.throws(() => fs + "", /staging error/)
  assert.throws(() => `${fs}`, /staging error/)
  assert.throws(() => +fs, /staging error/)
  assert.throws(() => fs.toString(), /staging error/)
  assert.throws(() => fs.valueOf(), /staging error/)
})

test("type surfaces throw the same staging error", () => {
  const t = texpr(Type.Param("T"))
  assert.throws(() => String(t), /staging error: a param node/)
  assert.throws(() => t.toString(), /staging error/)
})

test("emit dispatch rejects nulls, primitives, and untagged objects loudly", () => {
  const emit = makeEmit(text)
  assert.throws(() => emit.expr(null as any), /expected an IR node, got null/)
  assert.throws(() => emit.expr(42 as any), /expected an IR node, got number/)
  assert.throws(() => emit.expr("nope" as any), /expected an IR node, got string/)
  assert.throws(() => emit.expr({} as any), /expected an IR node, got object/)
})

test("emit dispatch names a leaked surface proxy", () => {
  const emit = makeEmit(text)
  assert.throws(() => emit.expr($.ref("x")), /surface proxy leaked into the IR \(norm\(\) it first\)/)
  assert.throws(() => emit.statement($.ref("x") as any), /surface proxy leaked into the IR/)
  assert.throws(() => emit.type($.ref("x") as any), /surface proxy leaked into the IR/)
})

test("text target rejects reserved-word identifiers like the babel target", () => {
  const program = Program.build(function*() {
    const nope = yield* $.Const("delete", 5)
    return nope
  })
  assert.throws(() => emitProgramText(program), /Cannot emit invalid identifier "delete" \(in binding\)/)
  assert.throws(() => emitProgram(program), /Cannot emit invalid identifier "delete"/)
})

test("text and babel targets agree on unicode identifiers", () => {
  const program = Program.build(function*() {
    const café = yield* $.Const("café", 5)
    return café
  })
  assert.equal(emitProgramText(program), "const café = 5;")
  assert.equal(emitProgram(program), "const café = 5;")
})

test("collectImports rejects two sources mapping to one local name", () => {
  const program = Program.build(function*() {
    const a = yield* $.Const("a", $.import_("pkg/a", "moda"))
    const b = yield* $.Const("b", $.import_("pkg/b", "moda"))
    return a
  })
  assert.throws(() => emitProgramText(program), /cannot import "moda" from both "pkg\/a" and "pkg\/b"/)
  assert.throws(() => emitProgram(program), /cannot import "moda" from both/)
})

test("collectImports still dedupes one import used many times", () => {
  const program = Program.build(function*() {
    const a = yield* $.Const("a", $.import_("node:fs").readFileSync("x"))
    const b = yield* $.Const("b", $.import_("node:fs").readFileSync("y"))
    return a
  })
  assert.equal(
    emitProgramText(program),
    `import * as fs from "node:fs";
const a = fs.readFileSync("x");
const b = fs.readFileSync("y");`,
  )
})
