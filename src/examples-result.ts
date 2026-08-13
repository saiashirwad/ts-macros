import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"

export const program = Program.build(function*() {
  // a whole generic type declaration in one call: name from the callsite,
  // params from the arrow, literals/objects/params tnorm'd into nodes
  const Result = yield* $.type((T, E) =>
    $.union(
      { ok: true, value: T },
      { ok: false, error: E },
    )
  )

  const StringOrNumber = $.apply(Result, [$.T.string, $.T.number])

  const parse = yield* $.fun([$.Param("raw", $.T.string)], function*({ raw }) {
    yield* $.If($.eq(raw, ""), function*() {
      // Return is a sink: a raw object lifts field by field
      yield* $.Return({ ok: false, error: 400 })
    })
    // impl final returns lift too; the VarRef inside passes through
    return { ok: true, value: raw }
  })

  const outcome = yield* $.Const(parse("hello"))

  return outcome
})

console.log(emitProgram(program))
