import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins early returns, nested whiles and boolean results feeding conditions: probe() must return 8 on every target
// (divisibility is simulated with subtraction — the IR has no modulo operator)
export const program = Program.build(function*() {
  const isPrime = yield* $.Function("is_prime").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Boolean()),
    $.Impl(function*({ n }) {
      yield* $.If($.lt(n, $.Number(2)), function*() {
        yield* $.Return($.Boolean(false))
      })
      const i = yield* $.Let("i", $.Number(2))
      yield* $.While($.lt(i, n), function*() {
        const r = yield* $.Let("r", n)
        yield* $.While($.gte(r, i), function*() {
          yield* $.Assign(r, $.sub(r, i))
        })
        yield* $.If($.eq(r, $.Number(0)), function*() {
          yield* $.Return($.Boolean(false))
        })
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return $.Boolean(true)
    }),
  )

  const countPrimes = yield* $.Function("count_primes").pipe(
    $.Params($.Param("upto", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ upto }) {
      const count = yield* $.Let("count", $.Number(0))
      const i = yield* $.Let("i", $.Number(2))
      yield* $.While($.lt(i, upto), function*() {
        yield* $.If(isPrime(i), function*() {
          yield* $.Assign(count, $.add(count, $.Number(1)))
        })
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return count
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return countPrimes($.Number(20))
    }),
  )
})
