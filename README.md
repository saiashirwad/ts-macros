# ts-macros

`ts-macros` is my attempt at doing typed staged metaprogramming in TypeScript.

The TypeScript compiler checks the types of the expressions you construct, not just the shape of their AST nodes. Use it to turn schemas, query plans, or configuration into specialized programs.

## Example

```ts
import * as $ from "@texoport/ts-macros"
import { emitProgram } from "@texoport/ts-macros/targets/ts"

const program = $.build(function*() {
  const double = yield* $.fn("double", {
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      return $.mul(x, 2)
    },
  })

  // $.call(double, "21") // Type error in stage 1.
  yield* $.const("answer", $.call(double, 21))
})

console.log(emitProgram(program))
```

Emits TypeScript source:

```text
function double(x: number) {
  return x * 2;
}
const answer = double(21);
```

Passing `"21"` rather than `21` is a type error in the builder, before any code is emitted.

## Explore

Run the [repository example](examples/typed-construction.ts) with Node 24 and pnpm:

```sh
pnpm install
node examples/typed-construction.ts
```

For larger applications, see the [schema validator](examples/validation/demo.ts) and [in-memory query compiler](examples/memq/demo.ts).

## Other languages

`ts-macros/lang` is a kernel for languages with their own type systems. A language is a record of capabilities: typing rules written as type lambdas. Constructs such as `let`, `if` and function declarations state the capabilities they need, and each language checks them with its own rules. Targets are open records of handlers keyed by node kind, and `emit` is a type error unless the target handles every kind the program uses.

[`examples/c.ts`](examples/c.ts) builds C with integer widths, pointers and C's usual arithmetic conversions. TypeScript rejects `int16_t*` where `double*` is expected while you write the builder. [`languages/c.ts`](languages/c.ts) and [`languages/typescript.ts`](languages/typescript.ts) share the same constructs, and each file lists the checks that run at build time.
