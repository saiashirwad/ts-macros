import * as $ from "../src/$.ts"
import * as Binding from "../src/binding.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
import { emitProgramC, int, type Owned, owned } from "../targets/c/index.ts"

const malloc = $.Value<(bytes: number) => Owned<number[]>>("malloc")
const printf = $.Value<(...args: any[]) => number>("printf")
const sizeofDouble = () => $.Call($.Value<(type: any) => number>("sizeof"), $.Value<any>("double"))

const doubles = () => Type.Array(Type.Number())

export const program = Program.build(function*() {
  const makeSquares = yield* $.Function("make_squares").pipe(
    $.Params($.Param("n", int())),
    $.Returns(owned(doubles())),
    $.Impl(function*({ n }) {
      const xs = yield* Binding.Const("xs").pipe(
        Binding.Init($.Call(malloc, $.mul(n, sizeofDouble()))),
        Binding.Annotate(owned(doubles())),
      )
      const i = yield* Binding.Let("i").pipe(Binding.Init($.Number(0)), Binding.Annotate(int()))
      yield* $.While($.lt(i, n), function*() {
        const d = yield* $.Const("d", $.sub($.sub(n, 1), i))
        yield* $.Assign($.Index(xs, i), $.mul(d, d))
        yield* $.Assign(i, $.add(i, 1))
      })
      return xs
    }),
  )

  const insertionSort = yield* $.Function("insertion_sort").pipe(
    $.Params($.Param("xs", doubles()), $.Param("n", int())),
    $.Impl(function*({ xs, n }) {
      const i = yield* Binding.Let("i").pipe(Binding.Init($.Number(1)), Binding.Annotate(int()))
      yield* $.While($.lt(i, n), function*() {
        const key = yield* $.Const("key", $.Index(xs, i))
        const j = yield* Binding.Let("j").pipe(Binding.Init($.sub(i, 1)), Binding.Annotate(int()))
        yield* $.While($.and($.gte(j, 0), $.gt($.Index(xs, j), key)), function*() {
          yield* $.Assign($.Index(xs, $.add(j, 1)), $.Index(xs, j))
          yield* $.Assign(j, $.sub(j, 1))
        })
        yield* $.Assign($.Index(xs, $.add(j, 1)), key)
        yield* $.Assign(i, $.add(i, 1))
      })
    }),
  )

  const binarySearch = yield* $.Function("binary_search").pipe(
    $.Params($.Param("xs", doubles()), $.Param("n", int()), $.Param("target", Type.Number())),
    $.Returns(int()),
    $.Impl(function*({ xs, n, target }) {
      const lo = yield* Binding.Let("lo").pipe(Binding.Init($.Number(0)), Binding.Annotate(int()))
      const hi = yield* Binding.Let("hi").pipe(Binding.Init(n), Binding.Annotate(int()))
      yield* $.While($.lt(lo, hi), function*() {
        const mid = yield* Binding.Const("mid").pipe(
          Binding.Init($.div($.add(lo, hi), $.Number(2))),
          Binding.Annotate(int()),
        )
        yield* $.If($.eq($.Index(xs, mid), target), function*() {
          yield* $.Return(mid)
        }).elseif($.lt($.Index(xs, mid), target), function*() {
          yield* $.Assign(lo, $.add(mid, 1))
        }).else(function*() {
          yield* $.Assign(hi, mid)
        })
      })
      return $.Number(-1)
    }),
  )

  const main = yield* $.Function("main").pipe(
    $.Returns(int()),
    $.Impl(function*() {
      const xs = yield* $.Const("xs", makeSquares(10))
      yield* $.Do(insertionSort(xs, 10))
      const found = yield* $.Const("found", binarySearch(xs, 10, 25))
      yield* $.Do($.Call(printf, $.String("found at index %d\n"), found))
      return $.norm(0)
    }),
  )

  return main
})

export const source = ["#include <stdio.h>", "#include <stdlib.h>", "", emitProgramC(program), ""].join("\n")

if (import.meta.main) {
  console.log(source)
}
