# ts-macros

Plain values lift automatically when their types describe their structure. Values typed `{}`, `object`, or `Object` cannot be lifted, including inside arrays or records. Write an empty object literal as `Expr.object({})` instead of a bare `{}`.

```ts
import { Decl, Expr, Program, Type } from "ts-macros"
import { emitProgram } from "ts-macros/targets/typescript"

function power(x: Expr.In<number>, n: number): Expr.Expr<number> {
  let result: Expr.Expr<number> = Expr.number(1)
  for (let i = 0; i < n; i++) result = Expr.mul(result, x)
  return result
}

function* savedPower(x: Expr.In<number>, n: number) {
  return yield* Decl.const_("tmp", power(x, n))
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
