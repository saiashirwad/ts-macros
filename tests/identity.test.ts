import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { emitProgram } from "../targets/ts.ts"

const literalValue = (type: T.Type<any> | undefined): string | number | bigint | boolean | null =>
  (type as T.AnyType | undefined)?.kind === "literal" ? (type as T.LiteralType).value : null

test("shadowed bindings keep distinct identities and types", () => {
  let outer!: T.Ref<number, any, any>
  let inner!: T.Ref<string, any, any>
  T.build(function*() {
    outer = yield* T.const("value", T.numberLiteral(1))
    yield* T.if(T.booleanLiteral(true), function*() {
      inner = yield* T.const("value", T.stringLiteral("inner"))
      yield* T.do(T.call(T.hostValue<any>("use"), outer, inner))
    })
    return outer
  })

  assert.notEqual(outer.id, inner.id)
  assert.equal(literalValue(outer.type), 1)
  assert.equal(literalValue(inner.type), "inner")
})

test("local bindings are freshened around imported names", () => {
  const imported = T.hostImport<{ readonly read: () => string }>("files", "files")
  const program = T.build(function*() {
    const local = yield* T.const("files", T.numberLiteral(1))
    yield* T.do(T.call(T.prop(imported, "read")))
    return local
  })

  const expected = `import * as files from "files";\nconst files_2 = 1;\nfiles.read();`
  assert.equal(emitProgram(program), expected)
})

test("a helper may declare the same const hint twice in one scope", () => {
  function* helper() {
    return yield* T.const("tmp", 1)
  }
  const program = T.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    yield* T.const("sum", T.add(first, second))
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(emitProgram(program), "const tmp = 1;\nconst tmp_2 = 1;\nconst sum = tmp + tmp_2;")
})

test("a helper may declare the same alias hint twice in one scope", () => {
  function* helper() {
    const alias = yield* T.type("Tmp", { params: [T.TypeParam("T")], body: ({ T: TParam }) => T.Array(TParam) })
    yield* T.const("tmp", [1], T.Apply(alias, [T.Number]))
    return alias
  }
  const program = T.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(sameType(program.result.first, program.result.second), false)
  assert.equal(emitProgram(program), "type Tmp<T> = T[];\nconst tmp: Tmp<number> = [1];\ntype Tmp_2<T> = T[];\nconst tmp_2: Tmp_2<number> = [1];")
})

test("alias renaming avoids mapped-type keys", () => {
  const program = T.build(function*() {
    yield* T.const("A", 0)
    const a = yield* T.type("A", T.Number)
    const m = yield* T.type("M", T.Mapped("A_2", T.Object({ a: T.String }), a))
    return yield* T.const("actual", { a: 1 }, m)
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3 = number;\ntype M = { [A_2 in keyof { a: string }]: A_3 };\nconst actual: M = { a: 1 };")
})

test("alias renaming avoids infer binders", () => {
  const program = T.build(function*() {
    yield* T.const("A", 0)
    const a = yield* T.type("A", {
      params: [T.TypeParam("T")],
      body: ({ T: TParam }) => T.Array(TParam),
    })
    return yield* T.type("M", T.Conditional(T.String, T.Infer("A_2"), T.Apply(a, [T.Number]), T.Never))
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3<T> = T[];\ntype M = string extends (infer A_2) ? A_3<number> : never;")
})

test("alias renaming avoids type parameters", () => {
  const program = T.build(function*() {
    yield* T.const("A", 0)
    const a = yield* T.type("A", T.Number)
    return yield* T.type("M", {
      params: [T.TypeParam("A_2")],
      body: () => T.Array(a),
    })
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3 = number;\ntype M<A_2> = A_3[];")
})

test("alias references cannot escape their block", () => {
  let alias!: T.TypeRef<string>
  assert.throws(() =>
    T.build(function*() {
      yield* T.if(true, function*() {
        alias = yield* T.type("Local", T.String)
      })
      yield* T.const("value", "x", alias)
      return null
    }), /does not resolve to an in-scope binding/)
})
