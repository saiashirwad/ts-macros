import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { emitProgramC } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import * as FFI from "./ffi.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

test("c target emits annotated functions and bindings", () => {
  const program = Program.build(function*() {
    const clamp = yield* $.Function("clamp").pipe(
      $.Params($.Param("x", Type.Number())),
      $.Returns(Type.Number()),
      $.Impl(function*({ x }) {
        yield* $.If($.gt(x, 100), function*() {
          yield* $.Return(100)
        })
        return x
      }),
    )
    const limit = yield* $.Const("limit", clamp(150))
    return limit
  })

  assert.equal(
    emitProgramC(program),
    `double clamp(double x) {
  if (x > 100) {
    return 100;
  }
  return x;
}
const auto limit = clamp(150);`,
  )
})

test("c target spells prop access with an arrow and equality without triple equals", () => {
  const point = FFI.Value<{ x: number }>("point")
  const program = Program.build(function*() {
    const same = yield* $.Const("same", $.eq(Expr.Prop(point, "x"), 3))
    return same
  })

  assert.equal(emitProgramC(program), "const auto same = point->x == 3;")
})

test("c target rejects node kinds with no C spelling", () => {
  const throwsOn = (body: () => Generator<any, any, unknown>, message: RegExp) => assert.throws(() => emitProgramC(Program.build(body)), message)

  throwsOn(function*() {
    yield* $.Do($.Template(["a", "b"], $.String("x")))
    return $.norm(0)
  }, /c target: no template literals/)

  throwsOn(function*() {
    yield* $.forOf("item", FFI.Value<number[]>("items"), function*() {
      yield* $.Break()
    })
    return $.norm(0)
  }, /c target: no for-of/)

  throwsOn(function*() {
    const fs = $.import_<{ readFileSync(path: string): string }>("node:fs")
    const data = yield* $.Const("data", fs.readFileSync("a.txt"))
    return data
  }, /c target: no module imports/)

  throwsOn(function*() {
    const untyped = yield* $.fun("untyped", [], function*() {
      return $.norm(1)
    })
    return untyped
  }, /c target: function "untyped" needs an explicit return type/)
})
