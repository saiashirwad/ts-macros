import * as $ from "../src/$.ts"
import { emitProgram, emitProgramC, emitProgramText } from "../src/emit/index.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"

const program = Program.build(function*() {
  const clamp = yield* $.Function("clamp").pipe(
    $.Params($.Param("x", Type.Number()), $.Param("limit", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ x, limit }) {
      yield* $.If($.gt(x, limit), function*() {
        yield* $.Return(limit)
      })
      return x
    }),
  )
  const capped = yield* $.Const("capped", clamp(150, 100))
  return capped
})

console.log("--- typescript (babel)")
console.log(emitProgram(program))
console.log("--- typescript (text)")
console.log(emitProgramText(program))
console.log("--- c")
console.log(emitProgramC(program))
