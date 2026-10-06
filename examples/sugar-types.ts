import * as T from "../src/index.ts"

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

const fs = T.hostImport<FileSystem>("node:fs", "fs")
const api = T.hostValue<NumericApi>("api")
const readFile = T.prop(fs, "readFile")
const scale = T.prop(api, "scale")
const matrix = T.prop(api, "matrix")
const text = T.call(readFile, "input.txt")
const scaled = T.call(scale, 2)
const matrixSum = T.call(T.prop(T.call(matrix, 2, 2), "sum"))
const record = T.objectLiteral({ count: 1, label: "ok" })
const recordCount = T.prop(record, "count")
const sum = T.add(1, 2)
const comparison = T.gte(sum, scaled)
const shortCircuit = T.and(true, 1)

check<Equal<T.Denotes<typeof text>, string>>(true)
check<Equal<T.Denotes<typeof scaled>, number>>(true)
check<Equal<T.Denotes<typeof matrixSum>, number>>(true)
check<Equal<T.Denotes<typeof recordCount>, number>>(true)
check<Equal<T.Denotes<typeof sum>, number>>(true)
check<Equal<T.Denotes<typeof comparison>, boolean>>(true)
check<Equal<T.Denotes<typeof shortCircuit>, 1>>(true)
// @ts-expect-error - readFile takes a string
T.call(readFile, 1)
// @ts-expect-error - scale takes a number
T.call(scale, "two")

export const program = T.build(function*() {
  const mutable = yield* T.let("mutable", 1)
  check<Equal<T.Denotes<typeof mutable>, number>>(true)
  yield* T.assign(mutable, T.add(mutable, 1))

  const constant = yield* T.const("constant", 42)
  check<Equal<T.Denotes<typeof constant>, 42>>(true)

  yield* T.forOf("item", [1, 2, 3], function*(item) {
    check<Equal<T.Denotes<typeof item>, number>>(true)
  })

  yield* T.forOf("literal", [1, 2, 3] as const, function*(item) {
    check<Equal<T.Denotes<typeof item>, number>>(true)
  })

  const target = yield* T.let("target", T.Object({ id: T.Readonly(T.Number), count: T.Number }))
  const writable = T.prop(target, "count")
  const readonly = T.prop(target, "id")
  check<Equal<T.WriteType<typeof writable>, number>>(true)
  check<Equal<T.Denotes<typeof readonly>, number>>(true)
  yield* T.assign(writable, 1)

  const labeler = yield* T.fn("labeler", {
    params: [T.param("value", T.Number)],
    returns: T.String,
    body: function*() {
      return "ok"
    },
  })
  const label = T.call(labeler, 1)
  check<Equal<T.Denotes<typeof label>, string>>(true)
  // @ts-expect-error - labeler takes a number
  T.call(labeler, "one")

  const TParam = T.TypeParam("T")
  const identity = yield* T.fn("identity", {
    typeParams: [TParam],
    params: [T.param("value", TParam)],
    returns: TParam,
    body: function*({ value }) {
      return value
    },
  })
  const numberIdentity = T.instantiate(identity, T.Number)
  const identityResult = T.call(numberIdentity, 1)
  check<Equal<T.Denotes<typeof identityResult>, number>>(true)

  return target
})
