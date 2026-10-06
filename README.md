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
