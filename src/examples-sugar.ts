import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

// the same shapes as examples.ts, written in the sugar dsl. compare:
//
//   const Classify = yield* $.Function("classify").pipe(              // core
//     $.Params($.Param("score", Type.Number())),
//     $.Impl(function*({ score }) { ... }),
//   )
//   const classify = yield* $.fun([$.Param("score", Type.Number())], function*({ score }) { ... })

// a typed ffi module — surfaces give autocomplete and type-checked calls,
// but every node is still the closed vocabulary the emitter already knows
interface Vec {
  sum(): number
}
interface Mat {
  mul(v: Vec): Mat
  sum(): number
}
interface Linalg {
  matrix(rows: number, cols: number): Mat
  vector(...xs: number[]): Vec
}

export const program = Program.build(function*() {
  const classify = yield* $.fun([$.Param("score", Type.Number())], function*({ score }) {
    const grade = yield* $.Let("F")
    yield* $.If($.gte(score, 90), function*() {
      const curved = yield* $.Const($.add(score, 5))
      yield* $.If($.gt(curved, 100), function*() {
        yield* $.Assign(grade, "A+")
      }).else(function*() {
        yield* $.Assign(grade, "A")
      })
    }).elseif($.gte(score, 80), function*() {
      yield* $.Assign(grade, "B")
    }).elseif($.gte(score, 70), function*() {
      yield* $.Assign(grade, "C")
    })
    return grade
  })

  const sumUntil = yield* $.fun([$.Param("limit", Type.Number())], function*({ limit }) {
    const total = yield* $.Let(0)
    const current = yield* $.Let(1)
    yield* $.While(true, function*() {
      const next = yield* $.Const($.add(total, current))
      yield* $.If($.gt(next, limit), function*() {
        yield* $.Break()
      })
      yield* $.Assign(total, next)
      yield* $.Assign(current, $.add(current, 1))
    })
    return total
  })

  const firstBig = yield* $.fun([$.Param("numbers", Type.Array(Type.Number()))], function*({ numbers }) {
    const seen = yield* $.Let(0)
    yield* $.forOf(numbers, function*(n) {
      const squared = yield* $.Const($.mul(n, n))
      yield* $.Assign(seen, $.add(seen, 1))
      yield* $.If($.gt(squared, 100), function*() {
        yield* $.Return(squared)
      })
    })
    return "none"
  })

  const res = yield* $.Const(firstBig([3, 11, 7]))

  const anyLong = yield* $.fun([$.Param("items", Type.Array(Type.String()))], function*({ items }) {
    const list = $.expr(items)
    return $.gt(list.length, 10)
  })

  // surfaces: calls read like the language being emitted, raw args lift
  const linalg = $.import_<Linalg>("linalg")
  const answer = yield* $.Const(linalg.matrix(2, 2).mul(linalg.vector(1, 2)).sum())

  const fs = $.import_<typeof import("node:fs")>("node:fs")

  const pkg = yield* $.Const(fs.readFileSync("package.json"))

  const config = yield* $.Const({ debug: true, retries: 3 })

  const label = yield* $.Const(classify(93))
  const total = yield* $.Const(sumUntil(50))
  const big = yield* $.Const(firstBig([3, 11, 7]))
  const long = yield* $.Const(anyLong([label]))

  // Do is a sink: it takes the surface a call returns, no deref needed
  const con = $.ref<Console>("console")
  yield* $.Do(con.log("answer:", answer))
  // yield* $.Do(con.log("pkg bytes:", $.expr(pkg).length))

  // norm lifts a plain object wholesale; the VarRefs inside pass through
  return $.norm({ label, total, big, long, config })
})

console.log(emitProgram(program))
