import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { emitProgram } from "../targets/ts.ts"

const literalValue = (type: $.Type<any> | undefined): string | number | bigint | boolean | null =>
  (type as $.AnyType | undefined)?.kind === "literal" ? (type as $.Literal).value : null

test("shadowed bindings keep distinct identities and types", () => {
  let outer!: $.Ref<number, any, any>
  let inner!: $.Ref<string, any, any>
  $.build(function*() {
    outer = yield* $.const("value", $.number(1))
    yield* $.if($.boolean(true), function*() {
      inner = yield* $.const("value", $.string("inner"))
      yield* $.do($.call($.hostValue<any>("use"), outer, inner))
    })
    return outer
  })

  assert.notEqual(outer.id, inner.id)
  assert.equal(literalValue(outer.type), 1)
  assert.equal(literalValue(inner.type), "inner")
})

test("local bindings are freshened around imported names", () => {
  const imported = $.hostImport<{ readonly read: () => string }>("files", "files")
  const program = $.build(function*() {
    const local = yield* $.const("files", $.number(1))
    yield* $.do($.call($.prop(imported, "read")))
    return local
  })

  const expected = `import * as files from "files";\nconst files_2 = 1;\nfiles.read();`
  assert.equal(emitProgram(program), expected)
})

test("a helper may declare the same const hint twice in one scope", () => {
  function* helper() {
    return yield* $.const("tmp", 1)
  }
  const program = $.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    yield* $.const("sum", $.add(first, second))
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(emitProgram(program), "const tmp = 1;\nconst tmp_2 = 1;\nconst sum = tmp + tmp_2;")
})

test("a helper may declare the same alias hint twice in one scope", () => {
  function* helper() {
    const alias = yield* $.type("Tmp", { params: [$.TypeParam("T")], body: ({ T }) => $.Array(T) })
    yield* $.const("tmp", [1], $.Apply(alias, [$.Number]))
    return alias
  }
  const program = $.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(sameType(program.result.first, program.result.second), false)
  assert.equal(emitProgram(program), "type Tmp<T> = T[];\nconst tmp: Tmp<number> = [1];\ntype Tmp_2<T> = T[];\nconst tmp_2: Tmp_2<number> = [1];")
})

test("alias renaming avoids mapped-type keys", () => {
  const program = $.build(function*() {
    yield* $.const("A", 0)
    const a = yield* $.type("A", $.Number)
    const m = yield* $.type("M", $.Mapped("A_2", $.Object({ a: $.String }), a))
    return yield* $.const("actual", { a: 1 }, m)
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3 = number;\ntype M = { [A_2 in keyof { a: string }]: A_3 };\nconst actual: M = { a: 1 };")
})

test("alias renaming avoids infer binders", () => {
  const program = $.build(function*() {
    yield* $.const("A", 0)
    const a = yield* $.type("A", {
      params: [$.TypeParam("T")],
      body: ({ T }) => $.Array(T),
    })
    return yield* $.type("M", $.Conditional($.String, $.Infer("A_2"), $.Apply(a, [$.Number]), $.Never))
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3<T> = T[];\ntype M = string extends (infer A_2) ? A_3<number> : never;")
})

test("alias renaming avoids type parameters", () => {
  const program = $.build(function*() {
    yield* $.const("A", 0)
    const a = yield* $.type("A", $.Number)
    return yield* $.type("M", {
      params: [$.TypeParam("A_2")],
      body: () => $.Array(a),
    })
  })
  assert.equal(emitProgram(program), "const A = 0;\ntype A_3 = number;\ntype M<A_2> = A_3[];")
})

test("alias references cannot escape their block", () => {
  let alias!: $.TypeRef<string>
  assert.throws(() =>
    $.build(function*() {
      yield* $.if(true, function*() {
        alias = yield* $.type("Local", $.String)
      })
      yield* $.const("value", "x", alias)
      return null
    }), /does not resolve to an in-scope binding/)
})
