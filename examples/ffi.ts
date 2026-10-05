import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const console_ = FFI.Value<Console>("console")
const json = FFI.Value<JSON>("JSON")
const math = FFI.Value<Math>("Math")
const log = Expr.prop(console_, "log")
const parse = Expr.prop(json, "parse")
const stringify = Expr.prop(json, "stringify")
const floor = Expr.prop(math, "floor")
const max = Expr.prop(math, "max")

export const program = Program.build(function*() {
  const raw = yield* Decl.let_("raw", `{"name":"sai","score":91.7}`)

  const name = yield* Decl.const_("name", "hello")
  const upperCasedName = yield* Decl.const_(
    "upperCasedName",
    Expr.call(Expr.prop(name, "toUpperCase")),
  )
  yield* Stmt.do_(Expr.call(log, upperCasedName))

  const parsed = yield* Decl.const_(
    "parsed",
    Expr.call(parse, raw),
    Type.object({ name: Type.string, score: Type.number }),
  )

  const something = yield* Decl.const_("something", Expr.call(stringify, Expr.object({ key: "hi", value: 5 })))
  yield* Stmt.do_(Expr.call(log, something))

  const score = yield* Decl.const_("score", Expr.call(floor, Expr.prop(parsed, "score")))

  const best = yield* Decl.const_("best", Expr.call(max, score, 100))

  const path = FFI.Import<typeof import("node:path")>("node:path", "path")
  const basename = Expr.prop(path, "basename")
  const file = yield* Decl.const_("file", Expr.call(basename, "/tmp/scores.json"))

  const bestFile = yield* Decl.const_("bestFile", {
    best,
    file,
  })

  yield* Stmt.do_(Expr.call(log, Expr.prop(parsed, "name")))
  yield* Stmt.do_(Expr.call(log, bestFile))
})

console.log(emitProgram(program))
