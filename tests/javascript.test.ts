import assert from "node:assert/strict"
import { test } from "node:test"

import { emitProgram } from "ts-macros/targets/js"
import * as $ from "../src/index.ts"

const run = (program: $.Program<unknown>, result: string): any => new Function(`${emitProgram(program)}\nreturn ${result}`)()

test("JavaScript erases binding, function, and arrow annotations", () => {
  const program = $.build(function*() {
    const empty = yield* $.let("empty", $.Number)
    const count = yield* $.let("count", 2, $.Number)
    const offset = yield* $.const("offset", 3, $.Number)
    yield* $.assign(empty, count)
    yield* $.fn("add", {
      params: [$.param("value", $.Number)],
      returns: $.Number,
      body: function*({ value }) {
        return $.add(value, offset)
      },
    })
    yield* $.const(
      "double",
      $.arrow({
        params: [$.param("value", $.Number)],
        returns: $.Number,
        body: function*({ value }) {
          return $.mul(value, 2)
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
  const program = $.build(function*() {
    yield* $.fn("collect", {
      params: [$.param("first", $.Number), $.optional("second", $.Number), $.rest("rest", $.Number)],
      body: function*({ first, second, rest }) {
        return $.object({ first, second, rest })
      },
    })
    yield* $.const(
      "arrow",
      $.arrow({
        params: [$.param("first", $.Number), $.optional("second", $.Number), $.rest("rest", $.Number)],
        body: function*({ first, second, rest }) {
          return $.object({ first, second, rest })
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
  const T = $.TypeParam("T", $.Number)
  const identity = $.arrow({
    typeParams: [T],
    params: [$.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const program = $.build(function*() {
    const fn = yield* $.fn("identity", {
      typeParams: [T],
      params: [$.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    yield* $.const("first", $.call($.instantiate(fn, $.Number), 3))
    yield* $.const("second", $.call($.instantiate(identity, $.Number), 4))
    return null
  })
  assert.equal(
    emitProgram(program),
    "function identity(value) {\n  return value;\n}\nconst first = identity(3);\nconst second = ((value) => {\n  return value;\n})(4);",
  )
  assert.deepEqual(run(program, "[first, second]"), [3, 4])
})

test("nested type aliases disappear without empty lines in runtime blocks", () => {
  const program = $.build(function*() {
    yield* $.type("Outer", $.Number)
    yield* $.fn("sum", {
      body: function*() {
        yield* $.type("Inner", $.Number)
        const sum = yield* $.let("total", 0, $.Number)
        yield* $.forOf("item", [1, 2], function*(item) {
          yield* $.type("Loop", $.Number)
          yield* $.if(true, function*() {
            yield* $.type("Branch", $.Number)
            yield* $.assign(sum, $.add(sum, item))
          })
        })
        yield* $.while(false, function*() {
          yield* $.type("Never", $.Number)
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
  const aliasOnly = $.build(function*() {
    yield* $.type("class", $.External("not a type identifier"))
    return null
  })
  const blockOnly = $.build(function*() {
    yield* $.if(true, function*() {
      yield* $.type("Alias", $.String)
    }).pipe($.else(function*() {
      yield* $.type("Other", $.Number)
    }))
    return null
  })
  assert.equal(emitProgram(aliasOnly), "")
  assert.equal(emitProgram(blockOnly), "if (true) {} else {}")
  assert.equal(run(blockOnly, "1"), 1)
})

test("JavaScript does not render erased parameter, return, annotation, or argument types", () => {
  const erased = $.External<number>("not a type identifier")
  const T = $.TypeParam("T")
  const program = $.build(function*() {
    yield* $.const("value", 1, erased)
    const fn = yield* $.fn("identity", {
      typeParams: [T],
      params: [$.param("input", T)],
      returns: T,
      body: function*({ input }) {
        return input
      },
    })
    yield* $.const("result", $.call($.instantiate(fn, erased), 2))
    yield* $.const(
      "typed",
      $.arrow({
        params: [$.param("input", erased)],
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
  const path = $.hostImport<{ basename: (path: string) => string }>("node:path", "path")
  const program = $.build(function*() {
    yield* $.const("result", $.call($.prop(path, "basename"), "/tmp/example.txt"))
    return null
  })
  const source = emitProgram(program)
  assert.equal(source, "import * as path from \"node:path\";\nconst result = path.basename(\"/tmp/example.txt\");")
  const module = await import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { result };`)}`)
  assert.equal(module.result, "example.txt")
})

test("FFI imports retain collision diagnostics and freshen local bindings", () => {
  const first = $.hostImport<{ value: number }>("first-module", "shared")
  const second = $.hostImport<{ value: number }>("second-module", "shared")
  const collision = $.build(function*() {
    yield* $.do($.prop(first, "value"))
    yield* $.do($.prop(second, "value"))
    return null
  })
  assert.throws(() => emitProgram(collision), /import local "shared" refers to both "first-module" and "second-module"/)

  const renamed = $.build(function*() {
    const local = yield* $.const("shared", 2, $.Number)
    yield* $.const("result", $.add(local, $.prop(first, "value")))
    return null
  })
  assert.equal(
    emitProgram(renamed),
    "import * as shared from \"first-module\";\nconst shared_2 = 2;\nconst result = shared_2 + shared.value;",
  )
})
