import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

const T = Type.Param("T")
const E = Type.Param("E")

// value-level sugar throughout; the Type.* declaration machinery is the
// type-level dsl and stays as-is
export const program = Program.build(function*() {
  const Result = yield* Type.Type("Result").pipe(
    Type.TypeParams(T, E),
    Type.Body(Type.Union(
      Type.Object({ ok: Type.Literal(true), value: T }),
      Type.Object({ ok: Type.Literal(false), error: E }),
    )),
  )

  const StringOrNumber = Type.Apply(Result, [Type.String(), Type.Number()])

  const parse = yield* $.fun([$.Param("raw", Type.String())], function*({ raw }) {
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
