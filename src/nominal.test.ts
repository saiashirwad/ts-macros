import assert from "node:assert/strict"
import test from "node:test"

import { emitProgram } from "../targets/babel/index.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

test("nominal type carrying erasure emits fallback TS type", () => {
  const Int = Type.Nominal<number>("Int", Type.Number())
  const F32 = Type.Nominal<number>("F32", Type.Number())

  const program = Program.build(function*() {
    yield* Fn.Function("add").pipe(
      Fn.Params(Fn.Param("a", Int), Fn.Param("b", F32)),
      Fn.Returns(Int),
      Fn.Impl(function*({ a, b }) {
        return a
      }),
    )
    return null
  })

  const code = emitProgram(program)
  // TS emitter lowers both Int and F32 to number via erasesTo
  assert.match(code, /function add\(a: number, b: number\): number/)
})

test("plain Type.Ref without erasure continues to emit its explicit name", () => {
  const CustomRef = Type.Ref("MyCustomType")

  const program = Program.build(function*() {
    yield* Fn.Function("process").pipe(
      Fn.Params(Fn.Param("x", CustomRef)),
      Fn.Returns(CustomRef),
      Fn.Impl(function*({ x }) {
        return x
      }),
    )
    return null
  })

  const code = emitProgram(program)
  assert.match(code, /function process\(x: MyCustomType\): MyCustomType/)
})
