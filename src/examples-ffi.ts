import { emitProgram } from "../targets/babel/index.ts"
import * as $ from "./$.ts"
import * as Program from "./program.ts"
import * as Std from "./std/std.ts"
import * as Type from "./types/index.ts"

export const program = Program.build(function*() {
  const raw = yield* $.Let("raw").pipe($.Init($.String(`{"name":"sai","score":91.7}`)))

  const name = yield* $.Const("name").pipe($.Init($.String("hello")))
  const upperCasedName = yield* $.Const("upperCasedName").pipe($.Init($.Call($.Prop(name, "toUpperCase"))))
  yield* $.Do($.Call(Std.Console.log, upperCasedName))

  const parsed = yield* $.Const("parsed").pipe(
    $.Init($.Call(Std.JSON.parse, raw)),
    $.Annotate(Type.Object({ name: Type.String(), score: Type.Number() })),
  )

  const something = yield* $.Const("something").pipe($.Init($.Call(
    Std.JSON.stringify,
    $.Object({ key: $.String("hi"), value: $.Number(5) }),
  )))
  yield* $.Do($.Call(Std.Console.log, something))

  const score = yield* $.Const("score").pipe(
    $.Init($.Call(Std.Math.floor, $.Prop(parsed, "score"))),
  )

  const best = yield* $.Const("best").pipe($.Init($.Call(Std.Math.max, score, $.Number(100))))

  const path = $.Import<typeof import("node:path")>("node:path")
  const file = yield* $.Const("file").pipe($.Init($.Call($.Prop(path, "basename"), $.String("/tmp/scores.json"))))

  const bestFile = yield* $.Const("bestFile").pipe($.Init(
    $.Object({
      best,
      file,
    }),
  ))

  yield* $.Do($.Call(Std.Console.log, $.Prop(parsed, "name")))
  yield* $.Do($.Call(Std.Console.log, bestFile))
})

console.log(emitProgram(program))
