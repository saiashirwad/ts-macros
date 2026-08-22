# ts-macros

Build typed programs as data in TypeScript, then emit them for another runtime.

Instead of gluing source code together as strings, you build expressions, statements, functions, and types through a typed API. The result is an immutable intermediate representation (IR) that you can inspect, validate, transform, and emit through a swappable backend — JavaScript, TypeScript, or C today.

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

Emits:

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

The TypeScript compiler checks the program you are _building_: `classify("x")` is a type error, `Stmt.If(score, ...)` is rejected because `score` is not boolean, and `classify`'s return type is inferred as `string` from its branches.

## How it works

**Generators are the macro language.** A program body is a `function*`. Each `yield*` adds a statement to the current block and hands back a typed reference — a `VarRef` for a binding, a callable `FunctionRef` for a function. Nested bodies (`If`, `While`, `ForOf`, `Impl`) are generators too, so scoping follows the shape of your code.

**Every node carries its type.** Literals, property access, binary operators, calls, and conditionals all compute a `TypeExpr` when built. `let` widens literal initializers so reassignment type-checks; `const` keeps them narrow. Return types are inferred as the union of every `return` path.

**Materialization is pure.** `Program.build` drains the generators into a `Statement[]`, resolves forward references between functions (so mutual recursion works), back-fills known types, and validates scopes — shadowed bindings get distinct identities and distinct emitted names. Nodes are rebuilt, never mutated.

**Emitters are backends.** A target implements a handler per node tag. `targets/babel` emits JavaScript through `@babel/generator`, `targets/typescript` emits text, and `targets/c` emits C with an ownership system that frees owned values after last use. Differential tests run the same programs through the TypeScript and C emitters and compare runtime output.

## Sugar and surfaces

The core API is explicit: `Expr.Binary(">=", score, Expr.Number(60))`. The `Sugar` module lifts plain values for you and gives operators names: `Sugar.gte(score, 60)`.

A **surface** goes further. It wraps a node in a `Proxy` so it reads like the value it stands for. Property access builds `Prop` nodes, calls build `Call` nodes, and the types flow through:

```ts
interface FileSystem {
  readFile(path: string): string
}
interface Api {
  matrix(rows: number, cols: number): { sum(): number }
}

const fs = Sugar.import_<FileSystem>("node:fs")
const api = Sugar.ref<Api>("api")

const text = fs.readFile("input.txt") // denotes string
const sum = api.matrix(2, 2).sum() // denotes number
```

Surfaces refuse to be coerced. `` `${s}` ``, `s + 1`, and `await s` all throw a staging error, because those operators run now, at build time, and cannot see into the program you are building. Use `Sugar.add` and friends instead.

## Layout

```
src/
  expr.ts        expressions: literals, refs, props, binary/unary, cond, objects, arrays
  statement.ts   statements: return, throw, if/else, while, for-of, break, continue
  function.ts    Function / Params / Returns / Impl builders, Call, Arrow
  binding.ts     Let / Const / Init / Annotate
  program.ts     Program.build: materialize, annotate, validate
  types/         type AST and lattice (lub, widen), primitives, literals, generics, nominal
  sugar/         value lifting (norm), operator helpers, proxy surfaces
  scope/         scope and binding validation
  ffi.ts         references to host values and imports
  std/           typed bindings for Array, String, Math, JSON, Promise, console
  walk.ts        cycle-safe IR walker
targets/
  babel/         JavaScript via @babel/generator
  typescript/    TypeScript text
  c/             C, with ownership lowering
examples/        overview, sugar, ffi, and differential-test programs
tests/           node --test suites
```

## Development

```sh
pnpm install
pnpm test        # node --test
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format      # dprint
```

There is no build step; the package is consumed as TypeScript source. Run any example directly: `node examples/sugar.ts`.

## Where it is going

The IR is the main artifact; emitters are replaceable views over it. That lets tools understand a program before it runs: analyzers, optimizers, visualizers, policy checks, and multiple execution targets all work from one representation.

One application is agent code mode. An agent could describe a multi-step workflow — search files, prepare patches, ask for approval, run tests — as a typed program. The runtime could read off its required capabilities, enforce policies and budgets, show a preview, then execute or resume it. That will need an effect system for capabilities such as file access, shell commands, network calls, model calls, and subagents. The first execution target would likely be an Effect program, with JSON, JavaScript, and others as further backends.

The open question is simple: can a typed, inspectable program representation give agents useful control over work that would otherwise hide inside a string of generated TypeScript?
