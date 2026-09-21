import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

// a host value is one line: its name, and the type TypeScript already has for it
const console_ = FFI.Value<Console>("console")
const json = FFI.Value<JSON>("JSON")
const math = FFI.Value<Math>("Math")
const log = Expr.prop(console_, "log")
const parse = Expr.prop(json, "parse")
const stringify = Expr.prop(json, "stringify")
const floor = Expr.prop(math, "floor")
const max = Expr.prop(math, "max")

export const program = Program.build(function*() {
  const raw = yield* Binding.let_("raw", `{"name":"sai","score":91.7}`)

  const name = yield* Binding.const_("name", "hello")
  const upperCasedName = yield* Binding.const_(
    "upperCasedName",
    Expr.call(Expr.prop(name, "toUpperCase")),
  )
  yield* Stmt.do_(Expr.call(log, upperCasedName))

  const parsed = yield* Binding.const_(
    "parsed",
    Expr.call(parse, raw),
    Type.object({ name: Type.string, score: Type.number }),
  )

  const something = yield* Binding.const_("something", Expr.call(stringify, Expr.object({ key: "hi", value: 5 })))
  yield* Stmt.do_(Expr.call(log, something))

  const score = yield* Binding.const_("score", Expr.call(floor, Expr.prop(parsed, "score")))

  const best = yield* Binding.const_("best", Expr.call(max, score, 100))

  const path = FFI.Import<typeof import("node:path")>("node:path", "path")
  const basename = Expr.prop(path, "basename")
  const file = yield* Binding.const_("file", Expr.call(basename, "/tmp/scores.json"))

  const bestFile = yield* Binding.const_("bestFile", {
    best,
    file,
  })

  yield* Stmt.do_(Expr.call(log, Expr.prop(parsed, "name")))
  yield* Stmt.do_(Expr.call(log, bestFile))
})

console.log(emitProgram(program))
