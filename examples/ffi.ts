import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const console_ = T.hostValue<Console>("console")
const json = T.hostValue<JSON>("JSON")
const math = T.hostValue<Math>("Math")
const log = T.prop(console_, "log")
const parse = T.prop(json, "parse")
const stringify = T.prop(json, "stringify")
const floor = T.prop(math, "floor")
const max = T.prop(math, "max")

export const program = T.build(function*() {
  const raw = yield* T.let("raw", `{"name":"sai","score":91.7}`)

  const name = yield* T.const("name", "hello")
  const upperCasedName = yield* T.const(
    "upperCasedName",
    T.call(T.prop(name, "toUpperCase")),
  )
  yield* T.do(T.call(log, upperCasedName))

  const parsed = yield* T.const(
    "parsed",
    T.call(parse, raw),
    T.Object({ name: T.String, score: T.Number }),
  )

  const something = yield* T.const("something", T.call(stringify, T.objectLiteral({ key: "hi", value: 5 })))
  yield* T.do(T.call(log, something))

  const score = yield* T.const("score", T.call(floor, T.prop(parsed, "score")))

  const best = yield* T.const("best", T.call(max, score, 100))

  const path = T.hostImport<typeof import("node:path")>("node:path", "path")
  const basename = T.prop(path, "basename")
  const file = yield* T.const("file", T.call(basename, "/tmp/scores.json"))

  const bestFile = yield* T.const("bestFile", {
    best,
    file,
  })

  yield* T.do(T.call(log, T.prop(parsed, "name")))
  yield* T.do(T.call(log, bestFile))
})

console.log(emitProgram(program))
