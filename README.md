# ts-macros

Staged metaprogramming for TypeScript.

```ts
import * as $ from "ts-macros"
import { emitProgram } from "ts-macros/targets/ts"

function power(x: $.In<number>, n: number): $.Expr<number> {
  let result: $.Expr<number> = $.number(1)
  for (let i = 0; i < n; i++) result = $.mul(result, x)
  return result
}

function* savedPower(x: $.In<number>, n: number) {
  return yield* $.const("tmp", power(x, n))
}

const program = $.build(function*() {
  return yield* $.fn("polynomial", {
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return $.add(cube, square)
    },
  })
})

console.log(emitProgram(program))
```

```text
function polynomial(x: number) {
  const tmp = 1 * x * x * x;
  const tmp_2 = 1 * x * x;
  return tmp + tmp_2;
}
```

## Emit JavaScript

```ts
import { emitProgram as emitJavaScript } from "ts-macros/targets/js"

console.log(emitJavaScript(program))
```

```text
function polynomial(x) {
  const tmp = 1 * x * x * x;
  const tmp_2 = 1 * x * x;
  return tmp + tmp_2;
}
```

## Narrow with guards

```ts
body: function*({ input }) {
  yield* $.ifGuard($.isArray(input), function*(items) {
    yield* $.return($.prop(items, "length"))
  }, "items")
  const text = yield* $.guard($.isTypeof(input, "string"), function*() {
    yield* $.return(0)
  }, "text")
  return $.prop(text, "length")
}
```

```text
function size(input: unknown) {
  if (Array.isArray(input)) {
    const items: unknown[] = input;
    return items.length;
  }
  if (!(typeof input === "string")) {
    return 0;
  }
  const text: string = input;
  return text.length;
}
```

## Read a property with a runtime key

```ts
const { row } = $.paramBindings([
  $.param("row", $.Object({ age: $.Number, name: $.String })),
])
const key: string = "age"
const age = $.checkedProp(row, key, $.Number)
const adult = $.gte(age, 18)
```

## Keyword APIs

Reserved words are exported under their natural spellings, so they need no trailing underscore:

| Group        | Members                                                             |
| ------------ | ------------------------------------------------------------------- |
| Declarations | `let`, `const`, `type`                                              |
| Expressions  | `null`, `typeof`                                                    |
| Guards       | `in`                                                                |
| Statements   | `return`, `throw`, `do`, `break`, `continue`, `if`, `else`, `while` |

These names replace the suffixed exports, such as `let_` and `return_`.
Type constructors are capitalized (`$.Number`, `$.Union`, `$.KeyOf`, `$.Null`); expression constructors are lowercase (`$.number(1)`, `$.array(1, 2)`, `$.null()`). Plain values are lifted automatically where expressions are accepted.
Type-node interfaces share their constructor's name: `$.Array($.Number)` returns `$.Array<typeof $.Number>`. The `$` import alias keeps the DSL separate from local bindings and generic parameters.
`$.NonPrimitive` is the primitive `object` type; `$.Object(fields)` constructs an object type with fields.

## Examples

- [memq](examples/memq/demo.ts): an in-memory query compiler
- [validation](examples/validation/README.md): schemas compiled to JavaScript validators
