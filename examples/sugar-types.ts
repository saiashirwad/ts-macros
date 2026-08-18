import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
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

const fs = Sugar.import_<FileSystem>("node:fs")
const api = Sugar.ref<NumericApi>("api")
const text = fs.readFile("input.txt")
const scaled = api.scale(2)
const matrixSum = api.matrix(2, 2).sum()
const record = Sugar.expr(Expr.Object({ count: Expr.Number(1), label: Expr.String("ok") }))
const recordCount = record.count
const sum = Sugar.add(1, 2)
const comparison = Sugar.gte(sum, scaled)
const shortCircuit = Sugar.and(true, 1)

check<Equal<Sugar.Denote<typeof text>, string>>(true)
check<Equal<Sugar.Denote<typeof scaled>, number>>(true)
check<Equal<Sugar.Denote<typeof matrixSum>, number>>(true)
check<Equal<Sugar.Denote<typeof recordCount>, 1>>(true)
check<Equal<Expr.Denotes<typeof sum>, number>>(true)
check<Equal<Expr.Denotes<typeof comparison>, boolean>>(true)
check<Equal<Expr.Denotes<typeof shortCircuit>, true | 1>>(true)
check<Equal<number extends Parameters<typeof fs.readFile>[0] ? true : false, false>>(true)
check<Equal<string extends Parameters<typeof api.scale>[0] ? true : false, false>>(true)

export const program = Program.build(function*() {
  const mutable = yield* Sugar.Let("mutable", 1)
  check<Equal<Expr.Denotes<typeof mutable>, number>>(true)
  yield* Sugar.Assign(mutable, Sugar.add(mutable, 1))

  const constant = yield* Sugar.Const("constant", 42)
  check<Equal<Expr.Denotes<typeof constant>, 42>>(true)

  yield* Sugar.forOf([1, 2, 3], function*(item) {
    check<Equal<Expr.Denotes<typeof item>, 1 | 2 | 3>>(true)
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
  const label = labeler(1)
  check<Equal<Sugar.Denote<typeof label>, string>>(true)
  check<Equal<string extends Parameters<typeof labeler>[0] ? true : false, false>>(true)

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
