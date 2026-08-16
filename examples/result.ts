import * as $ from "../src/$.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/babel/index.ts"

const T = Type.Param("T")
const E = Type.Param("E")

export const program = Program.build(function*() {
  const Result = yield* Type.Type("Result").pipe(
    Type.TypeParams(T, E),
    Type.Body(Type.Union(
      Type.Object({ ok: Type.Literal(true), value: T }),
      Type.Object({ ok: Type.Literal(false), error: E }),
    )),
  )

  const _StringOrNumber = Type.Apply(Result, [Type.String(), Type.Number()])

  const Parse = yield* $.Function("parse").pipe(
    $.Params($.Param("raw", Type.String())),
    // $.Returns(StringOrNumber),
    $.Impl(function*({ raw }) {
      yield* $.If($.Binary("===", raw, $.String("")), function*() {
        yield* $.Return($.Object({ ok: $.Boolean(false), error: $.Number(400) }))
      })
      return $.Object({ ok: $.Boolean(true), value: raw })
    }),
  )

  const outcome = yield* $.Const("outcome").pipe($.Init($.Call(Parse, $.String("hello"))))

  return outcome
})

console.log(emitProgram(program))
