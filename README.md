# ts-macros

Write a program as typed data in TypeScript. Emit it as JavaScript, TypeScript, or C.

Most code generators build strings. You lose the types the moment you call `+=`, and the only way to check the output is to run it. ts-macros keeps the program as a tree of typed nodes for as long as possible. The TypeScript compiler checks the program while you build it, and an emitter turns the tree into text at the very end.

```ts
import { Fn, Program, Stmt, Sugar, Type } from "ts-macros"
import { emitProgram } from "ts-macros/targets/babel"

const program = Program.build(function*() {
  const classify = yield* Fn.Function("classify").pipe(
    Fn.Params(Fn.Param("score", Type.Number())),
    Fn.Impl(function*({ score }) {
      yield* Stmt.If(Sugar.gte(score, 90), function*() {
        yield* Stmt.Return(Sugar.norm("A"))
      }).pipe(
        Stmt.ElseIf(Sugar.gte(score, 60), function*() {
          yield* Stmt.Return(Sugar.norm("B"))
        }),
      )
      return Sugar.norm("C")
    }),
  )

  const values = yield* Sugar.Const("values", [1, 2, 3])
  const total = yield* Sugar.Let("total", 0)

  yield* Sugar.forOf("value", values, function*(value) {
    yield* Sugar.Assign(total, Sugar.add(total, Sugar.mul(value, 2)))
  })

  return Sugar.norm({ label: classify(total), total })
})

console.log(emitProgram(program))
```

That prints:

```ts
function classify(score: number): string {
  if (score >= 90) {
    return "A"
  } else if (score >= 60) {
    return "B"
  }
  return "C"
}
const values = [1, 2, 3]
let total = 0
for (const value of values) {
  total = total + value * 2
}
```

The checks happen in your editor, on the builder code. `classify("x")` fails to compile. `Stmt.If(score, ...)` fails because `score` is a number, not a boolean. `classify` gets the return type `string` without you writing it, because every `return` in its body is a string.

## How it works

A program body is a generator. Each `yield*` appends one statement to the current block and hands back a typed handle. `Sugar.Let` gives you a `VarRef`. `Fn.Function` gives you a `FunctionRef` you can call like a function. Bodies of `If`, `While`, `ForOf`, and `Impl` are generators too, so the nesting of your TypeScript is the nesting of the output.

Every node computes its type when you build it. `Sugar.add(total, 1)` knows it is a number. `record.count` knows it is whatever `count` was declared as. `let` widens a literal initializer so you can assign to it later; `const` keeps the literal. A function's return type is the union of every path that returns.

`Program.build` drains the generators, resolves forward references between functions (mutual recursion works), fills in types that were only known once every declaration existed, and checks scopes. Two bindings named `value` in nested scopes get different identities and come out as `value` and `value_2`. Nothing mutates. Every pass rebuilds the nodes it touches.

An emitter is a table of handlers, one per node tag. `targets/babel` goes through `@babel/generator`. `targets/typescript` writes text. An emitter for another language needs nothing from the core beyond the typed tree. If it needs every binding typed, `Program.annotate` re-runs the typing pass with an oracle that supplies types for host values the program did not declare.

## Sugar

The core API names every node. `Expr.Binary(">=", score, Expr.Number(60))` is honest but tiring. The `Sugar` module lifts plain values for you and gives operators names, so the same thing is `Sugar.gte(score, 60)`.

It also wraps nodes in a `Proxy` so they read like the value they stand for. Property access builds a `Prop` node. A call builds a `Call` node. The types come along:

```ts
interface FileSystem {
  readFile(path: string): string
}
interface Api {
  matrix(rows: number, cols: number): { sum(): number }
}

const fs = Sugar.import_<FileSystem>("node:fs")
const api = Sugar.ref<Api>("api")

const text = fs.readFile("input.txt") // string
const sum = api.matrix(2, 2).sum() // number
```

One trap worth knowing about. If you write `` `${text}` ``, `sum + 1`, or `await sum`, the proxy throws. Those operators run now, while you are building the program, and they would quietly turn your node into `"[object Object]"`. The throw tells you to use `Sugar.add` instead. I would rather fail loudly at build time than debug that in emitted code.

## Layout

```
src/
  expr.ts        literals, refs, props, binary and unary ops, cond, objects, arrays
  statement.ts   return, throw, if/else, while, for-of, break, continue; draining bodies
  function.ts    Function, Params, Returns, Impl, Call, Arrow, Instantiate
  binding.ts     Let, Const, Init, Annotate
  program.ts     Program.build and the typing pass (Program.annotate)
  scope.ts       scope checks and emitted names
  types/         the type AST, its lattice, and type declarations
  sugar/         value lifting, operator helpers, proxies
  ffi.ts         references to host values and imports
  std/           typed bindings for Array, String, Math, JSON, Promise, console
  emit/          the Target protocol emitters implement, import collection
  pipeable.ts    .pipe, node brands, builders
  walk.ts        IR walker
targets/
  babel/         JavaScript via @babel/generator
  typescript/    TypeScript text
examples/
tests/
```

## Development

```sh
pnpm install
pnpm test        # node --test
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format      # dprint
```

There is no build step. The package is plain TypeScript source, and Node runs it directly. `node examples/sugar.ts` prints the program above.

Two tests keep the types honest from both sides. `tests/typing.test.ts` builds a table of programs and asserts, inline and at compile time, what every reference denotes (`typeOf(ref).is<number>()`). The same programs are then emitted with every inferred type written out as an annotation, pinned as text, and handed to `tsc --strict`, so the runtime inference and the phantoms are checked against each other and against the compiler.

## Where this is going

The tree is the product. Emitters are views of it. Once a program exists as data you can analyze it, optimize it, draw it, or check it against a policy before anything runs.

The use I care most about is agents writing code. Today an agent that wants to search some files, prepare a patch, ask for approval, and run the tests hands you a string of TypeScript, and you either trust it or read it. If that workflow were a ts-macros program instead, the runtime could list the capabilities it needs, enforce a budget, show a preview, and then run it or pause it halfway. That needs an effect system for file access, shell commands, network calls, model calls, and subagents. I expect the first execution target to be an Effect program, with JSON and JavaScript as further emitters.

I don't know yet whether a typed, inspectable program gives an agent enough control to be worth the ceremony. That is the question this repo exists to answer.
