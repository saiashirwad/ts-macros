import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"

export const program = Program.build(function*() {
  const Result = yield* $.type(["T", "E"], (T, E) => $.union({ ok: true, value: T }, { ok: false, error: E }))

  const ParseResult = yield* $.type($.apply(Result, [$.T.string, $.T.number]))

  const parse = yield* $.fun([$.Param("raw", $.T.string)], function*({ raw }) {
    yield* $.If($.eq(raw, ""), function*() {
      yield* $.Return({ ok: false, error: 400 })
    })
    return { ok: true, value: raw }
  })

  const outcome = yield* $.Const(parse("hello"))

  return outcome
})

console.log(emitProgram(program))
