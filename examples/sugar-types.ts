// Not a program to run: a page of compile-time checks on what the constructors
// infer. It passes by typechecking.

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"

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
const readFile = Expr.prop(fs, "readFile")
const scale = Expr.prop(api, "scale")
const matrix = Expr.prop(api, "matrix")
const text = Expr.call(readFile, "input.txt")
const scaled = Expr.call(scale, 2)
const matrixSum = Expr.call(Expr.prop(Expr.call(matrix, 2, 2), "sum"))
const record = Expr.object({ count: 1, label: "ok" })
const recordCount = Expr.prop(record, "count")
const sum = Expr.add(1, 2)
const comparison = Expr.gte(sum, scaled)
const shortCircuit = Expr.and(true, 1)

check<Equal<Expr.Denotes<typeof text>, string>>(true)
check<Equal<Expr.Denotes<typeof scaled>, number>>(true)
check<Equal<Expr.Denotes<typeof matrixSum>, number>>(true)
check<Equal<Expr.Denotes<typeof recordCount>, 1>>(true)
check<Equal<Expr.Denotes<typeof sum>, number>>(true)
check<Equal<Expr.Denotes<typeof comparison>, boolean>>(true)
check<Equal<Expr.Denotes<typeof shortCircuit>, 1>>(true)
// @ts-expect-error - readFile takes a string
Expr.call(readFile, 1)
// @ts-expect-error - scale takes a number
Expr.call(scale, "two")

export const program = Program.build(function*() {
  const mutable = yield* Decl.let_("mutable", 1)
  check<Equal<Expr.Denotes<typeof mutable>, number>>(true)
  yield* Stmt.assign(mutable, Expr.add(mutable, 1))

  const constant = yield* Decl.const_("constant", 42)
  check<Equal<Expr.Denotes<typeof constant>, 42>>(true)

  yield* Stmt.forOf("item", [1, 2, 3], function*(item) {
    check<Equal<Expr.Denotes<typeof item>, number>>(true)
  })

  yield* Stmt.forOf("literal", [1, 2, 3] as const, function*(item) {
    check<Equal<Expr.Denotes<typeof item>, number>>(true)
  })

  const target = yield* Decl.let_("target", Type.object({ id: Type.readonly_(Type.number), count: Type.number }))
  const writable = Expr.prop(target, "count")
  const readonly = Expr.prop(target, "id")
  check<Equal<Stmt.WriteType<typeof writable>, number>>(true)
  check<Equal<Expr.Denotes<typeof readonly>, number>>(true)
  yield* Stmt.assign(writable, 1)

  const labeler = yield* Decl.fn("labeler", {
    params: [Expr.param("value", Type.number)],
    returns: Type.string,
    body: function*() {
      return "ok"
    },
  })
  const label = Expr.call(labeler, 1)
  check<Equal<Expr.Denotes<typeof label>, string>>(true)
  // @ts-expect-error - labeler takes a number
  Expr.call(labeler, "one")

  const T = Type.param("T")
  const identity = yield* Decl.fn("identity", {
    typeParams: [T],
    params: [Expr.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const numberIdentity = Expr.instantiate(identity, Type.number)
  const identityResult = Expr.call(numberIdentity, 1)
  check<Equal<Expr.Denotes<typeof identityResult>, number>>(true)

  return target
})
