import assert from "node:assert/strict"
import { test } from "node:test"

import { emitProgram } from "ts-macros/targets/js"
import * as T from "../src/index.ts"

const run = (program: T.Program<unknown>, result: string): any => new Function(`${emitProgram(program)}\nreturn ${result}`)()

test("JavaScript erases binding, function, and arrow annotations", () => {
  const program = T.build(function*() {
    const empty = yield* T.let("empty", T.Number)
    const count = yield* T.let("count", 2, T.Number)
    const offset = yield* T.const("offset", 3, T.Number)
    yield* T.assign(empty, count)
    yield* T.fn("add", {
      params: [T.param("value", T.Number)],
      returns: T.Number,
      body: function*({ value }) {
        return T.add(value, offset)
      },
    })
    yield* T.const(
      "double",
      T.arrow({
        params: [T.param("value", T.Number)],
        returns: T.Number,
        body: function*({ value }) {
          return T.mul(value, 2)
        },
      }),
    )
    return null
  })
  assert.equal(
    emitProgram(program),
    "let empty;\nlet count = 2;\nconst offset = 3;\nempty = count;\nfunction add(value) {\n  return value + offset;\n}\nconst double = (value) => {\n  return value * 2;\n};",
  )
  assert.equal(run(program, "double(add(empty))"), 10)
})

test("required, optional, and rest parameters preserve their runtime behavior", () => {
  const program = T.build(function*() {
    yield* T.fn("collect", {
      params: [T.param("first", T.Number), T.optional("second", T.Number), T.rest("rest", T.Number)],
      body: function*({ first, second, rest }) {
        return T.objectLiteral({ first, second, rest })
      },
    })
    yield* T.const(
      "arrow",
      T.arrow({
        params: [T.param("first", T.Number), T.optional("second", T.Number), T.rest("rest", T.Number)],
        body: function*({ first, second, rest }) {
          return T.objectLiteral({ first, second, rest })
        },
      }),
    )
    return null
  })
  assert.equal(
    emitProgram(program),
    "function collect(first, second, ...rest) {\n  return { first: first, second: second, rest: rest };\n}\nconst arrow = (first, second, ...rest) => {\n  return { first: first, second: second, rest: rest };\n};",
  )
  for (const name of ["collect", "arrow"]) {
    const fn = run(program, name)
    assert.deepEqual(fn(1), { first: 1, second: undefined, rest: [] })
    assert.deepEqual(fn(1, 2, 3, 4), { first: 1, second: 2, rest: [3, 4] })
  }
})

test("generic declarations and instantiated arrow callees emit runnable JavaScript", () => {
  const TParam = T.TypeParam("T", T.Number)
  const identity = T.arrow({
    typeParams: [TParam],
    params: [T.param("value", TParam)],
    returns: TParam,
    body: function*({ value }) {
      return value
    },
  })
  const program = T.build(function*() {
    const fn = yield* T.fn("identity", {
      typeParams: [TParam],
      params: [T.param("value", TParam)],
      returns: TParam,
      body: function*({ value }) {
        return value
      },
    })
    yield* T.const("first", T.call(T.instantiate(fn, T.Number), 3))
    yield* T.const("second", T.call(T.instantiate(identity, T.Number), 4))
    return null
  })
  assert.equal(
    emitProgram(program),
    "function identity(value) {\n  return value;\n}\nconst first = identity(3);\nconst second = ((value) => {\n  return value;\n})(4);",
  )
  assert.deepEqual(run(program, "[first, second]"), [3, 4])
})

test("nested type aliases disappear without empty lines in runtime blocks", () => {
  const program = T.build(function*() {
    yield* T.type("Outer", T.Number)
    yield* T.fn("sum", {
      body: function*() {
        yield* T.type("Inner", T.Number)
        const sum = yield* T.let("total", 0, T.Number)
        yield* T.forOf("item", [1, 2], function*(item) {
          yield* T.type("Loop", T.Number)
          yield* T.if(true, function*() {
            yield* T.type("Branch", T.Number)
            yield* T.assign(sum, T.add(sum, item))
          })
        })
        yield* T.while(false, function*() {
          yield* T.type("Never", T.Number)
        })
        return sum
      },
    })
    return null
  })
  assert.equal(
    emitProgram(program),
    "function sum() {\n  let total = 0;\n  for (const item of [1, 2]) {\n    if (true) {\n      total = total + item;\n    }\n  }\n  while (false) {}\n  return total;\n}",
  )
  assert.equal(run(program, "sum()"), 3)
})

test("alias-only programs and blocks erase without rendering type names or bodies", () => {
  const aliasOnly = T.build(function*() {
    yield* T.type("class", T.External("not a type identifier"))
    return null
  })
  const blockOnly = T.build(function*() {
    yield* T.if(true, function*() {
      yield* T.type("Alias", T.String)
    }).pipe(T.else(function*() {
      yield* T.type("Other", T.Number)
    }))
    return null
  })
  assert.equal(emitProgram(aliasOnly), "")
  assert.equal(emitProgram(blockOnly), "if (true) {} else {}")
  assert.equal(run(blockOnly, "1"), 1)
})

test("JavaScript does not render erased parameter, return, annotation, or argument types", () => {
  const erased = T.External<number>("not a type identifier")
  const TParam = T.TypeParam("T")
  const program = T.build(function*() {
    yield* T.const("value", 1, erased)
    const fn = yield* T.fn("identity", {
      typeParams: [TParam],
      params: [T.param("input", TParam)],
      returns: TParam,
      body: function*({ input }) {
        return input
      },
    })
    yield* T.const("result", T.call(T.instantiate(fn, erased), 2))
    yield* T.const(
      "typed",
      T.arrow({
        params: [T.param("input", erased)],
        returns: erased,
        body: function*({ input }) {
          return input
        },
      }),
    )
    return null
  })
  assert.deepEqual(run(program, "[value, result, typed(3)]"), [1, 2, 3])
})

test("namespace FFI imports execute in emitted ESM", async () => {
  const path = T.hostImport<{ basename: (path: string) => string }>("node:path", "path")
  const program = T.build(function*() {
    yield* T.const("result", T.call(T.prop(path, "basename"), "/tmp/example.txt"))
    return null
  })
  const source = emitProgram(program)
  assert.equal(source, "import * as path from \"node:path\";\nconst result = path.basename(\"/tmp/example.txt\");")
  const module = await import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { result };`)}`)
  assert.equal(module.result, "example.txt")
})

test("FFI imports retain collision diagnostics and freshen local bindings", () => {
  const first = T.hostImport<{ value: number }>("first-module", "shared")
  const second = T.hostImport<{ value: number }>("second-module", "shared")
  const collision = T.build(function*() {
    yield* T.do(T.prop(first, "value"))
    yield* T.do(T.prop(second, "value"))
    return null
  })
  assert.throws(() => emitProgram(collision), /import local "shared" refers to both "first-module" and "second-module"/)

  const renamed = T.build(function*() {
    const local = yield* T.const("shared", 2, T.Number)
    yield* T.const("result", T.add(local, T.prop(first, "value")))
    return null
  })
  assert.equal(
    emitProgram(renamed),
    "import * as shared from \"first-module\";\nconst shared_2 = 2;\nconst result = shared_2 + shared.value;",
  )
})
