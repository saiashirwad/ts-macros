import assert from "node:assert/strict"
import { test } from "node:test"

import { emitProgram } from "ts-macros/targets/js"
import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"

const run = (program: Program.Program<unknown>, result: string): any => new Function(`${emitProgram(program)}\nreturn ${result}`)()

test("JavaScript erases binding, function, and arrow annotations", () => {
  const program = Program.build(function*() {
    const empty = yield* Decl.let_("empty", Type.number)
    const count = yield* Decl.let_("count", 2, Type.number)
    const offset = yield* Decl.const_("offset", 3, Type.number)
    yield* Stmt.assign(empty, count)
    yield* Decl.fn("add", {
      params: [Expr.param("value", Type.number)],
      returns: Type.number,
      body: function*({ value }) {
        return Expr.add(value, offset)
      },
    })
    yield* Decl.const_(
      "double",
      Expr.arrow({
        params: [Expr.param("value", Type.number)],
        returns: Type.number,
        body: function*({ value }) {
          return Expr.mul(value, 2)
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
  const program = Program.build(function*() {
    yield* Decl.fn("collect", {
      params: [Expr.param("first", Type.number), Expr.optional("second", Type.number), Expr.rest("rest", Type.number)],
      body: function*({ first, second, rest }) {
        return Expr.object({ first, second, rest })
      },
    })
    yield* Decl.const_(
      "arrow",
      Expr.arrow({
        params: [Expr.param("first", Type.number), Expr.optional("second", Type.number), Expr.rest("rest", Type.number)],
        body: function*({ first, second, rest }) {
          return Expr.object({ first, second, rest })
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
  const T = Type.param("T", Type.number)
  const identity = Expr.arrow({
    typeParams: [T],
    params: [Expr.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const program = Program.build(function*() {
    const fn = yield* Decl.fn("identity", {
      typeParams: [T],
      params: [Expr.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    yield* Decl.const_("first", Expr.call(Expr.instantiate(fn, Type.number), 3))
    yield* Decl.const_("second", Expr.call(Expr.instantiate(identity, Type.number), 4))
    return null
  })
  assert.equal(
    emitProgram(program),
    "function identity(value) {\n  return value;\n}\nconst first = identity(3);\nconst second = ((value) => {\n  return value;\n})(4);",
  )
  assert.deepEqual(run(program, "[first, second]"), [3, 4])
})

test("nested type aliases disappear without empty lines in runtime blocks", () => {
  const program = Program.build(function*() {
    yield* Decl.type_("Outer", Type.number)
    yield* Decl.fn("sum", {
      body: function*() {
        yield* Decl.type_("Inner", Type.number)
        const sum = yield* Decl.let_("total", 0, Type.number)
        yield* Stmt.forOf("item", [1, 2], function*(item) {
          yield* Decl.type_("Loop", Type.number)
          yield* Stmt.if_(true, function*() {
            yield* Decl.type_("Branch", Type.number)
            yield* Stmt.assign(sum, Expr.add(sum, item))
          })
        })
        yield* Stmt.while_(false, function*() {
          yield* Decl.type_("Never", Type.number)
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
  const aliasOnly = Program.build(function*() {
    yield* Decl.type_("class", Type.external("not a type identifier"))
    return null
  })
  const blockOnly = Program.build(function*() {
    yield* Stmt.if_(true, function*() {
      yield* Decl.type_("Alias", Type.string)
    }).pipe(Stmt.else_(function*() {
      yield* Decl.type_("Other", Type.number)
    }))
    return null
  })
  assert.equal(emitProgram(aliasOnly), "")
  assert.equal(emitProgram(blockOnly), "if (true) {} else {}")
  assert.equal(run(blockOnly, "1"), 1)
})

test("JavaScript does not render erased parameter, return, annotation, or argument types", () => {
  const erased = Type.external<number>("not a type identifier")
  const T = Type.param("T")
  const program = Program.build(function*() {
    yield* Decl.const_("value", 1, erased)
    const fn = yield* Decl.fn("identity", {
      typeParams: [T],
      params: [Expr.param("input", T)],
      returns: T,
      body: function*({ input }) {
        return input
      },
    })
    yield* Decl.const_("result", Expr.call(Expr.instantiate(fn, erased), 2))
    yield* Decl.const_(
      "typed",
      Expr.arrow({
        params: [Expr.param("input", erased)],
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
  const path = FFI.Import<{ basename: (path: string) => string }>("node:path", "path")
  const program = Program.build(function*() {
    yield* Decl.const_("result", Expr.call(Expr.prop(path, "basename"), "/tmp/example.txt"))
    return null
  })
  const source = emitProgram(program)
  assert.equal(source, "import * as path from \"node:path\";\nconst result = path.basename(\"/tmp/example.txt\");")
  const module = await import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { result };`)}`)
  assert.equal(module.result, "example.txt")
})

test("FFI imports retain collision diagnostics and freshen local bindings", () => {
  const first = FFI.Import<{ value: number }>("first-module", "shared")
  const second = FFI.Import<{ value: number }>("second-module", "shared")
  const collision = Program.build(function*() {
    yield* Stmt.do_(Expr.prop(first, "value"))
    yield* Stmt.do_(Expr.prop(second, "value"))
    return null
  })
  assert.throws(() => emitProgram(collision), /import local "shared" refers to both "first-module" and "second-module"/)

  const renamed = Program.build(function*() {
    const local = yield* Decl.const_("shared", 2, Type.number)
    yield* Decl.const_("result", Expr.add(local, Expr.prop(first, "value")))
    return null
  })
  assert.equal(
    emitProgram(renamed),
    "import * as shared from \"first-module\";\nconst shared_2 = 2;\nconst result = shared_2 + shared.value;",
  )
})
