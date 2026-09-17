// Not a program to run: a page of compile-time checks on what the sugar layer
// infers. It passes by typechecking.

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Sugar from "../src/sugar/index.ts"
import * as Type from "../src/types/index.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const check = <T extends true>(_value: T): void => {}

interface FileSystem {
  readFile(path: string): string
}

interface NumericApi {
  scale(value: number): number
  matrix(rows: number, columns: number): {
    sum(): number
  }
}

const fs = FFI.Import<FileSystem>("node:fs", "fs")
const api = FFI.Value<NumericApi>("api")
const text = Sugar.call(Expr.Prop(fs, "readFile"), "input.txt")
const scaled = Sugar.call(Expr.Prop(api, "scale"), 2)
const matrixSum = Sugar.call(Expr.Prop(Sugar.call(Expr.Prop(api, "matrix"), 2, 2), "sum"))
const record = Expr.Object({ count: Expr.Number(1), label: Expr.String("ok") })
const recordCount = Expr.Prop(record, "count")
const sum = Sugar.add(1, 2)
const comparison = Sugar.gte(sum, scaled)
const shortCircuit = Sugar.and(true, 1)

check<Equal<Expr.Denotes<typeof text>, string>>(true)
check<Equal<Expr.Denotes<typeof scaled>, number>>(true)
check<Equal<Expr.Denotes<typeof matrixSum>, number>>(true)
check<Equal<Expr.Denotes<typeof recordCount>, 1>>(true)
check<Equal<Expr.Denotes<typeof sum>, number>>(true)
check<Equal<Expr.Denotes<typeof comparison>, boolean>>(true)
check<Equal<Expr.Denotes<typeof shortCircuit>, true | 1>>(true)
// @ts-expect-error - readFile takes a string
Sugar.call(Expr.Prop(fs, "readFile"), 1)
// @ts-expect-error - scale takes a number
Sugar.call(Expr.Prop(api, "scale"), "two")

export const program = Program.build(function*() {
  const mutable = yield* Sugar.Let("mutable", 1)
  check<Equal<Expr.Denotes<typeof mutable>, number>>(true)
  yield* Sugar.Assign(mutable, Sugar.add(mutable, 1))

  const constant = yield* Sugar.Const("constant", 42)
  check<Equal<Expr.Denotes<typeof constant>, 42>>(true)

  yield* Sugar.ForOf("item", [1, 2, 3], function*(item) {
    check<Equal<Expr.Denotes<typeof item>, number>>(true)
  })

  yield* Sugar.ForOf("literal", [1, 2, 3] as const, function*(item) {
    check<Equal<Expr.Denotes<typeof item>, number>>(true)
  })

  const target = yield* Binding.Let("target").pipe(
    Binding.Annotate(Type.Object({ id: Type.Readonly(Type.Number()), count: Type.Number() })),
  )
  const writable = Expr.Prop(target, "count")
  const readonly = Expr.Prop(target, "id")
  check<Equal<Expr.IsWritableTarget<typeof writable>, true>>(true)
  check<Equal<Expr.IsWritableTarget<typeof readonly>, false>>(true)
  yield* Sugar.Assign(writable, 1)

  const labeler = yield* Fn.Function("labeler").pipe(
    Fn.Params(Fn.Param("value", Type.Number())),
    Fn.Returns(Type.String()),
    Fn.Impl(function*() {
      return Expr.String("ok")
    }),
  )
  const label = Sugar.call(labeler, 1)
  check<Equal<Expr.Denotes<typeof label>, string>>(true)
  // @ts-expect-error - labeler takes a number
  Sugar.call(labeler, "one")

  const T = Type.Param("T")
  const identity = yield* Fn.Function("identity").pipe(
    Fn.TypeParams(T),
    Fn.Params(Fn.Param("value", T)),
    Fn.Returns(T),
    Fn.Impl(function*({ value }) {
      return value
    }),
  )
  const numberIdentity = Fn.Instantiate(identity, Type.Number())
  const identityResult = Fn.Call(numberIdentity, Expr.Number(1))
  check<Equal<Expr.Denotes<typeof identityResult>, number>>(true)

  return target
})
