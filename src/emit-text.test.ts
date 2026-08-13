import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { emitProgramText, exprToText, typeExprToText } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import * as FFI from "./ffi.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

test("text target emits a whole program", () => {
  const program = Program.build(function*() {
    const classify = yield* $.fun("classify", [$.Param("score", Type.Number())], function*({ score }) {
      const grade = yield* $.Let("grade", "F")
      yield* $.If($.gte(score, 90), function*() {
        yield* $.Assign(grade, "A")
      }).elseif($.gte(score, 80), function*() {
        yield* $.Assign(grade, "B")
      }).else(function*() {
        yield* $.Assign(grade, "C")
      })
      return grade
    })
    const label = yield* $.Const("label", classify(95))
    return label
  })

  assert.equal(
    emitProgramText(program),
    `function classify(score: number) {
  let grade = "F";
  if (score >= 90) {
    grade = "A";
  } else if (score >= 80) {
    grade = "B";
  } else {
    grade = "C";
  }
  return grade;
}
const label = classify(95);`,
  )
})

test("text target collects imports", () => {
  const program = Program.build(function*() {
    const fs = $.import_<{ readFileSync(path: string): string }>("node:fs")
    const data = yield* $.Const("data", fs.readFileSync("a.txt"))
    return data
  })

  assert.equal(
    emitProgramText(program),
    `import * as fs from "node:fs";
const data = fs.readFileSync("a.txt");`,
  )
})

test("text target parenthesizes by precedence", () => {
  const a = FFI.Value<number>("a")
  const b = FFI.Value<number>("b")
  const c = FFI.Value<number>("c")

  assert.equal(exprToText(Expr.Binary("*", Expr.Binary("+", a, b), c)), "(a + b) * c")
  assert.equal(exprToText(Expr.Binary("+", Expr.Binary("+", a, b), c)), "a + b + c")
  assert.equal(exprToText(Expr.Binary("+", a, Expr.Binary("+", b, c))), "a + (b + c)")
  assert.equal(exprToText(Expr.Binary("+", Expr.Binary("*", a, b), c)), "a * b + c")
  assert.equal(exprToText(Expr.Unary("!", Expr.Binary("&&", FFI.Value<boolean>("p"), FFI.Value<boolean>("q")))), "!(p && q)")
})

test("text target parenthesizes types by precedence", () => {
  assert.equal(typeExprToText(Type.Array(Type.Union(Type.String(), Type.Number()))), "(string | number)[]")
  assert.equal(typeExprToText(Type.Array(Type.Number())), "number[]")
  assert.equal(typeExprToText(Type.Union(Type.Function([], Type.Number()), Type.String())), "(() => number) | string")
  assert.equal(typeExprToText(Type.KeyOf(Type.Object({ a: Type.Number() }))), "keyof { a: number }")
})
