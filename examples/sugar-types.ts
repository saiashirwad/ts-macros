import * as $ from "../src/index.ts"

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

const fs = $.hostImport<FileSystem>("node:fs", "fs")
const api = $.hostValue<NumericApi>("api")
const readFile = $.prop(fs, "readFile")
const scale = $.prop(api, "scale")
const matrix = $.prop(api, "matrix")
const text = $.call(readFile, "input.txt")
const scaled = $.call(scale, 2)
const matrixSum = $.call($.prop($.call(matrix, 2, 2), "sum"))
const record = $.object({ count: 1, label: "ok" })
const recordCount = $.prop(record, "count")
const sum = $.add(1, 2)
const comparison = $.gte(sum, scaled)
const shortCircuit = $.and(true, 1)

check<Equal<$.Denotes<typeof text>, string>>(true)
check<Equal<$.Denotes<typeof scaled>, number>>(true)
check<Equal<$.Denotes<typeof matrixSum>, number>>(true)
check<Equal<$.Denotes<typeof recordCount>, number>>(true)
check<Equal<$.Denotes<typeof sum>, number>>(true)
check<Equal<$.Denotes<typeof comparison>, boolean>>(true)
check<Equal<$.Denotes<typeof shortCircuit>, 1>>(true)
// @ts-expect-error - readFile takes a string
$.call(readFile, 1)
// @ts-expect-error - scale takes a number
$.call(scale, "two")

export const program = $.build(function*() {
  const mutable = yield* $.let("mutable", 1)
  check<Equal<$.Denotes<typeof mutable>, number>>(true)
  yield* $.assign(mutable, $.add(mutable, 1))

  const constant = yield* $.const("constant", 42)
  check<Equal<$.Denotes<typeof constant>, 42>>(true)

  yield* $.forOf("item", [1, 2, 3], function*(item) {
    check<Equal<$.Denotes<typeof item>, number>>(true)
  })

  yield* $.forOf("literal", [1, 2, 3] as const, function*(item) {
    check<Equal<$.Denotes<typeof item>, number>>(true)
  })

  const target = yield* $.let("target", $.Object({ id: $.Readonly($.Number), count: $.Number }))
  const writable = $.prop(target, "count")
  const readonly = $.prop(target, "id")
  check<Equal<$.WriteType<typeof writable>, number>>(true)
  check<Equal<$.Denotes<typeof readonly>, number>>(true)
  yield* $.assign(writable, 1)

  const labeler = yield* $.fn("labeler", {
    params: [$.param("value", $.Number)],
    returns: $.String,
    body: function*() {
      return "ok"
    },
  })
  const label = $.call(labeler, 1)
  check<Equal<$.Denotes<typeof label>, string>>(true)
  // @ts-expect-error - labeler takes a number
  $.call(labeler, "one")

  const T = $.TypeParam("T")
  const identity = yield* $.fn("identity", {
    typeParams: [T],
    params: [$.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const numberIdentity = $.instantiate(identity, $.Number)
  const identityResult = $.call(numberIdentity, 1)
  check<Equal<$.Denotes<typeof identityResult>, number>>(true)

  return target
})
