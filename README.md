# ts-macros

Staged metaprogramming for TypeScript.

```ts
import * as T from "ts-macros"
import { emitProgram } from "ts-macros/targets/ts"

function power(x: T.In<number>, n: number): T.Expr<number> {
  let result: T.Expr<number> = T.numberLiteral(1)
  for (let i = 0; i < n; i++) result = T.mul(result, x)
  return result
}

function* savedPower(x: T.In<number>, n: number) {
  return yield* T.const("tmp", power(x, n))
}

const program = T.build(function*() {
  return yield* T.fn("polynomial", {
    params: [T.param("x", T.Number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return T.add(cube, square)
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
  yield* T.ifGuard(T.isArray(input), function*(items) {
    yield* T.return(T.prop(items, "length"))
  }, "items")
  const text = yield* T.guard(T.isTypeof(input, "string"), function*() {
    yield* T.return(0)
  }, "text")
  return T.prop(text, "length")
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
const { row } = T.paramBindings([
  T.param("row", T.Object({ age: T.Number, name: T.String })),
])
const key: string = "age"
const age = T.checkedProp(row, key, T.Number)
const adult = T.gte(age, 18)
```

## Keyword APIs

Reserved words are exported under their natural spellings, so they need no trailing underscore:

| Group        | Members                                                             |
| ------------ | ------------------------------------------------------------------- |
| Declarations | `let`, `const`, `type`                                              |
| Expressions  | `typeof`                                                            |
| Guards       | `in`                                                                |
| Statements   | `return`, `throw`, `do`, `break`, `continue`, `if`, `else`, `while` |

These names replace the suffixed exports, such as `let_` and `return_`.
Type constructors are capitalized (`T.Number`, `T.Union`, `T.KeyOf`, `T.Null`), so none of them need a reserved word.
`T.NonPrimitive` is the primitive `object` type; `T.Object(fields)` constructs an object type with fields.

## Examples

- [memq](examples/memq/demo.ts): an in-memory query compiler
- [validation](examples/validation/README.md): schemas compiled to JavaScript validators
