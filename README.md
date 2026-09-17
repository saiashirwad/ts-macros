# ts-macros

Write a program as typed data in TypeScript. Emit it as TypeScript.

Most code generators build strings. You lose the types the moment you call `+=`, and the only way to check the output is to run it. ts-macros keeps the program as a tree of typed nodes for as long as possible. The TypeScript compiler checks the program while you build it, and an emitter turns the tree into text at the very end.

```ts
import { Fn, Program, Stmt, Sugar, Type } from "ts-macros"
import { emitProgram } from "ts-macros/targets/typescript"

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

  yield* Sugar.ForOf("value", values, function*(value) {
    yield* Sugar.Assign(total, Sugar.add(total, Sugar.mul(value, 2)))
  })

  return Sugar.norm({ label: Sugar.call(classify, total), total })
})

console.log(emitProgram(program))
```

That prints:

```ts
function classify(score: number) {
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

The checks happen in your editor, on the builder code. `Sugar.call(classify, "x")` fails to compile. `Stmt.If(score, ...)` fails because `score` is a number, not a boolean. `classify` has the return type `"A" | "B" | "C"` without you writing it, and a call to it is an `Expr<"A" | "B" | "C">`. The emitter prints only the annotations you wrote, so the output leaves that one for TypeScript to infer, and it infers the same thing.

## How it works

A program body is a generator. Each `yield*` appends one statement to the current block and hands back a typed handle. `Sugar.Let` gives you a `VarRef`. `Fn.Function` gives you a `FunctionRef`. Bodies of `If`, `While`, `ForOf`, and `Impl` are generators too, so the nesting of your TypeScript is the nesting of the output. A body runs when the thing that holds it is yielded, never before, so a builder you construct and drop leaves no trace.

Every node knows its type twice. The phantom is a TypeScript type parameter, and it is what your editor checks. The `type` field is the same type as data, and it is what an emitter can print. `Sugar.add(total, 1)` knows it is a number. `record.count` knows it is whatever `count` was declared as. `let` widens a literal initializer so you can assign to it later; `const` keeps the literal. As in TypeScript, that applies only to a fresh literal, one that comes from a literal expression: `let first = xs[0]` keeps `"a" | "b"` if that is what `xs` was declared to hold. A function's return type is the union of every path that returns. Each rule is written once for the phantom and once for the data, and the two halves sit side by side: a node's own rule in its interface and constructor, the shared ones in `src/types/lattice.ts`.

`Program.build` drains the generators, resolves forward references between functions (mutual recursion works), fills in types that were only known once every declaration existed, and checks scopes. Two bindings named `value` in nested scopes get different identities and come out as `value` and `value_2`. Nothing mutates. Every pass rebuilds the nodes it touches.

An emitter is a table of handlers, one per node tag. There is one, `targets/typescript`. It writes text directly, with its own precedence rules, and has no dependencies. An emitter for another language needs nothing from the core beyond the typed tree. There was a C emitter earlier, with its own ownership analysis to insert frees, and a differential test suite that ran the same program through both targets and compared output. It came out in a simplification pass and hasn't gone back in.

## Sugar

The core API names every node. `Expr.Binary(">=", score, Expr.Number(60))` is honest but tiring. The `Sugar` module adds nothing new: each function lifts its plain arguments to nodes and calls the core constructor it stands for, so the same thing is `Sugar.gte(score, 60)`. Lifting keeps the types. `Sugar.norm(2)` is an `Expr<2>`, and an argument that does not fit is rejected where you wrote it:

```ts
interface FileSystem {
  readFile(path: string): string
}

const fs = FFI.Import<FileSystem>("node:fs", "fs")

const text = Sugar.call(Expr.Prop(fs, "readFile"), "input.txt") // Expr<string>
Sugar.call(Expr.Prop(fs, "readFile"), 1) // does not compile
```

A node is never dressed up as the value it stands for. There was a `Proxy` layer that let you write `fs.readFile("input.txt")`, and it read well, but it checked nothing the constructors do not already check, and an untyped one was `any`, which let a wrong program compile and fail later. It came out.

## Layout

```
src/
  index.ts       public exports
  node.ts        what a node is: the brands and the three node makers; the builder base class and its .pipe
  identity.ts    binding ids, independent of display names
  expr.ts        literals, refs, props, binary and unary ops, cond, objects, arrays
  statement.ts   assign, return, throw, if/else, while, for-of, break, continue; draining bodies
  function.ts    Function, Params, Returns, Impl, Call, Arrow, Instantiate
  binding.ts     Let, Const, Annotate, Init, Declare
  ffi.ts         references to host values and imports
  types/
    nodes.ts        every type node
    core.ts         what type nodes denote: the phantom algebra (variables, operators, substitution)
    declaration.ts  Type, TypeParams
    lattice.ts      the typing rules, each as a function on type nodes and as a type on phantoms
  program.ts     Program.build and the typing pass it runs
  scope.ts       scope checks and emitted names
  walk.ts        IR walker
  emit/          the Target protocol emitters implement, import collection
  sugar/         value lifting and the helpers built on it: operators, call, Let, Const, Assign, ForOf
targets/
  typescript/    TypeScript as text
examples/
tests/
```

Three conventions hold everywhere, and AGENTS.md spells them out. A node kind has one constructor, and that is the only place its record is written. A value that may be missing is `undefined`, never `null`, and a list is never missing, only empty. A builder is a description, and it becomes a node at the moment it is yielded. A declaration is a draft until its one terminal step (`Impl`, `Init`, `Declare`), and a draft cannot be yielded, so a function without a body or a `const` without a value does not compile.

## Development

```sh
pnpm install
pnpm test        # node --test
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format      # dprint
```

There is no build step. The package is plain TypeScript source, and Node runs it directly. `node examples/sugar.ts` prints a program much like the one above.

`tests/emit.test.ts` runs what the emitter writes and checks the result, so hand-written precedence and escaping cannot quietly change what a program means. Two more tests keep the types honest from both sides. `tests/typing.test.ts` builds a table of programs and asserts, inline and at compile time, what every reference denotes (`typeOf(ref).is<number>()`). The same programs are then emitted with every inferred type written out as an annotation, pinned as text, and handed to `tsc --strict`, so the runtime inference and the phantoms are checked against each other and against the compiler.

## Where this is going

The tree is the product. Emitters are views of it. Once a program exists as data you can analyze it, optimize it, draw it, or check it against a policy before anything runs.

The use I care most about is agents writing code. Today an agent that wants to search some files, prepare a patch, ask for approval, and run the tests hands you a string of TypeScript, and you either trust it or read it. If that workflow were a ts-macros program instead, the runtime could list the capabilities it needs, enforce a budget, show a preview, and then run it or pause it halfway. That needs an effect system for file access, shell commands, network calls, model calls, and subagents. I expect the first execution target to be an Effect program, with JSON and JavaScript as further emitters.

I don't know yet whether a typed, inspectable program gives an agent enough control to be worth the ceremony. That is the question this repo exists to answer.
