import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

export const program = Program.build(function*() {
  const con = $.ref<Console>("console")
  const json = $.ref<JSON>("JSON")
  const math = $.ref<Math>("Math")

  const raw = yield* $.Let(`{"name":"sai","score":91.7}`)

  const name = yield* $.Const("hello")
  // string method calls stay core: Surface<string> has no boxed members (yet)
  const upperCasedName = yield* $.Const($.Call($.Prop(name, "toUpperCase")))
  yield* $.Do(con.log(upperCasedName))

  const parsed = yield* $.Const(json.parse(raw)).pipe(
    $.Annotate(Type.Object({ name: Type.String(), score: Type.Number() })),
  )

  const something = yield* $.Const(json.stringify({ key: "hi", value: 5 }))
  yield* $.Do(con.log(something))

  const score = yield* $.Const(math.floor($.expr(parsed).score))
  const best = yield* $.Const(math.max(score, 100))

  const path = $.import_<typeof import("node:path")>("node:path")
  const file = yield* $.Const(path.basename("/tmp/scores.json"))

  const bestFile = yield* $.Const({ best, file })

  yield* $.Do(con.log($.expr(parsed).name))
  yield* $.Do(con.log(bestFile))
})

console.log(emitProgram(program))
