# ts-macros

Staged metaprogramming for TypeScript.

```ts
import { Decl, Expr, Program, Type } from "ts-macros"
import { emitProgram } from "ts-macros/targets/ts"

function power(x: Expr.In<number>, n: number): Expr.Expr<number> {
  let result: Expr.Expr<number> = Expr.number(1)
  for (let i = 0; i < n; i++) result = Expr.mul(result, x)
  return result
}

function* savedPower(x: Expr.In<number>, n: number) {
  return yield* Decl.const("tmp", power(x, n))
}

const program = Program.build(function*() {
  return yield* Decl.fn("polynomial", {
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return Expr.add(cube, square)
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
  yield* Stmt.ifGuard(Guard.isArray(input), function*(items) {
    yield* Stmt.return(Expr.prop(items, "length"))
  }, "items")
  const text = yield* Stmt.guard(Guard.typeof(input, "string"), function*() {
    yield* Stmt.return(0)
  }, "text")
  return Expr.prop(text, "length")
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
const { row } = Expr.paramBindings([
  Expr.param("row", Type.object({ age: Type.number, name: Type.string })),
])
const key: string = "age"
const age = Expr.checkedProp(row, key, Type.number)
const adult = Expr.gte(age, 18)
```

## Keyword APIs

Keyword names are namespace members, so they need no trailing underscore:

| Namespace | Members                                                             |
| --------- | ------------------------------------------------------------------- |
| `Decl`    | `let`, `const`, `type`                                              |
| `Expr`    | `null`, `typeof`                                                    |
| `Guard`   | `typeof`, `in`                                                      |
| `Stmt`    | `return`, `throw`, `do`, `break`, `continue`, `if`, `else`, `while` |
| `Type`    | `undefined`, `null`, `void`, `readonly`, `keyof`, `infer`           |

These names replace the suffixed exports, such as `Decl.let_` and `Stmt.return_`.
`Type.object_` remains the primitive `object` type; `Type.object(fields)` constructs an object type with fields.

## Examples

- [memq](examples/memq/demo.ts): an in-memory query compiler
- [validation](examples/validation/README.md): schemas compiled to JavaScript validators
