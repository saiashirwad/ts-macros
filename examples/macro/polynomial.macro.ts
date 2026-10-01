// A macro module: stage 1 builds the program, and the last line exports its
// declarations by name. Consumers see `polynomial: (x: number) => number`.

import { exports } from "../../macro/index.ts"
import { Decl, Expr, Program, Type } from "../../src/index.ts"

function power(x: Expr.In<number>, n: number): Expr.Expr<number> {
  let result: Expr.Expr<number> = Expr.number(1)
  for (let i = 0; i < n; i++) result = Expr.mul(result, x)
  return result
}

const program = Program.build(function*() {
  const cube = yield* Decl.fn("cube", {
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      return power(x, 3)
    },
  })
  const polynomial = yield* Decl.fn("polynomial", {
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      return Expr.add(Expr.call(cube, x), power(x, 2))
    },
  })
  return { cube, polynomial }
})

export const { cube, polynomial } = exports(program)
