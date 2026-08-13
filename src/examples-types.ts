import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"

export const program = Program.build(function*() {
  const NonNull = yield* $.type(["T"], (T) => $.cond(T, $.T.null, $.T.never, T))
  const PickName = yield* $.type(["T"], (T) => $.index(T, "name"))
  const Keys = yield* $.type(["T"], (T) => $.keyof(T))
  const Boxed = yield* $.type(["T"], (T) => $.mapped("K", T, (K) => $.index(T, K)))
  const Label = yield* $.type(["T"], (T) => $.tmpl`hello-${T}`)
  const First = yield* $.type(["T"], (T) => $.elementOf(T))

  void NonNull
  void PickName
  void Keys
  void Boxed
  void Label
  void First
  return 0
})

console.log(emitProgram(program))
