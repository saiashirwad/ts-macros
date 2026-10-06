import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const console_ = $.hostValue<Console>("console")
const json = $.hostValue<JSON>("JSON")
const math = $.hostValue<Math>("Math")
const log = $.prop(console_, "log")
const parse = $.prop(json, "parse")
const stringify = $.prop(json, "stringify")
const floor = $.prop(math, "floor")
const max = $.prop(math, "max")

export const program = $.build(function*() {
  const raw = yield* $.let("raw", `{"name":"sai","score":91.7}`)

  const name = yield* $.const("name", "hello")
  const upperCasedName = yield* $.const(
    "upperCasedName",
    $.call($.prop(name, "toUpperCase")),
  )
  yield* $.do($.call(log, upperCasedName))

  const parsed = yield* $.const(
    "parsed",
    $.call(parse, raw),
    $.Object({ name: $.String, score: $.Number }),
  )

  const something = yield* $.const("something", $.call(stringify, $.object({ key: "hi", value: 5 })))
  yield* $.do($.call(log, something))

  const score = yield* $.const("score", $.call(floor, $.prop(parsed, "score")))

  const best = yield* $.const("best", $.call(max, score, 100))

  const path = $.hostImport<typeof import("node:path")>("node:path", "path")
  const basename = $.prop(path, "basename")
  const file = yield* $.const("file", $.call(basename, "/tmp/scores.json"))

  const bestFile = yield* $.const("bestFile", {
    best,
    file,
  })

  yield* $.do($.call(log, $.prop(parsed, "name")))
  yield* $.do($.call(log, bestFile))
})

console.log(emitProgram(program))
