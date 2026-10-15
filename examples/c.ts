import { c, emitC } from "../languages/c.ts"

const i32 = (value: number) => c.literal(c.int(32), value)

export const program = c.program(function*() {
  const sum = yield* c.fn("sum", [c.param("values", c.ptr(c.int(16))), c.param("count", c.int(32))], c.int(64), function*(values, count) {
    const total = yield* c.let(c.int(64), "total", i32(0))
    const i = yield* c.let(c.int(32), "i", i32(0))
    yield* c.while(c.less(i, count), function*() {
      // int16_t promotes to int, then converts to int64_t
      yield* c.assign(total, c.add(total, c.deref(c.add(values, i))))
      yield* c.assign(i, c.add(i, i32(1)))
    })
    yield* c.return(total)
  })

  // c.let(c.ptr(c.double), "p", ...) // Type error in stage 1: int16_t* does not convert to double*.
  yield* c.fn("main", [], c.int(32), function*() {
    const x = yield* c.let(c.int(16), "x", i32(42))
    yield* c.run(c.call(sum, c.address(x), i32(1)))
    yield* c.return(i32(0))
  })
})

console.log(emitC(program))
