import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

// a host value is one line: its name, and the type TypeScript already has for it
const console_ = FFI.Value<Console>("console")
const json = FFI.Value<JSON>("JSON")
const math = FFI.Value<Math>("Math")
const log = Expr.Prop(console_, "log")

export const program = Program.build(function*() {
  const raw = yield* Binding.Let("raw").pipe(Binding.Init(Expr.String(`{"name":"sai","score":91.7}`)))

  const name = yield* Binding.Const("name").pipe(Binding.Init(Expr.String("hello")))
  const upperCasedName = yield* Binding.Const("upperCasedName").pipe(Binding.Init(Fn.Call(Expr.Prop(name, "toUpperCase"))))
  yield* Stmt.Do(Fn.Call(log, upperCasedName))

  const parsed = yield* Binding.Const("parsed").pipe(
    Binding.Init(Fn.Call(Expr.Prop(json, "parse"), raw)),
    Binding.Annotate(Type.Object({ name: Type.String(), score: Type.Number() })),
  )

  const something = yield* Binding.Const("something").pipe(Binding.Init(Fn.Call(
    Expr.Prop(json, "stringify"),
    Expr.Object({ key: Expr.String("hi"), value: Expr.Number(5) }),
  )))
  yield* Stmt.Do(Fn.Call(log, something))

  const score = yield* Binding.Const("score").pipe(
    Binding.Init(Fn.Call(Expr.Prop(math, "floor"), Expr.Prop(parsed, "score"))),
  )

  const best = yield* Binding.Const("best").pipe(Binding.Init(Fn.Call(Expr.Prop(math, "max"), score, Expr.Number(100))))

  const path = FFI.Import<typeof import("node:path")>("node:path")
  const file = yield* Binding.Const("file").pipe(Binding.Init(Fn.Call(Expr.Prop(path, "basename"), Expr.String("/tmp/scores.json"))))

  const bestFile = yield* Binding.Const("bestFile").pipe(Binding.Init(
    Expr.Object({
      best,
      file,
    }),
  ))

  yield* Stmt.Do(Fn.Call(log, Expr.Prop(parsed, "name")))
  yield* Stmt.Do(Fn.Call(log, bestFile))
})

console.log(emitProgram(program))
