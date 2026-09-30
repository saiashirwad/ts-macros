# ts-macros

typesafe staged metaprogramming in typescript

```ts
const fs = FFI.Import<{ readFile(path: string): string }>("node:fs", "fs")

const program = Program.build(function*() {
  const grade = yield* Decl.fn("grade", {
    params: [Expr.param("score", Type.number)],
    body: function*({ score }) {
      yield* Stmt.if_(Expr.gte(score, 90), function*() {
        yield* Stmt.return_("A")
      })
      return "B"
    },
  })

  const text = yield* Decl.const_(
    "text",
    Expr.call(Expr.prop(fs, "readFile"), "score.txt"),
  )
  yield* Decl.const_("result", Expr.call(grade, 93))

  Expr.call(grade, text) // ❌ type error: grade takes a number, text is a string
})

console.log(emitProgram(program))
```

```ts
import * as fs from "node:fs"
function grade(score: number) {
  if (score >= 90) {
    return "A"
  }
  return "B"
}
const text = fs.readFile("score.txt")
const result = grade(93)
```
