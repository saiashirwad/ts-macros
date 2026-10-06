import assert from "node:assert/strict"
import { test } from "node:test"
import * as $ from "../src/index.ts"

import { emitProgram } from "../targets/ts.ts"

const fn = $.fn

test("a yielded function declaration keeps its impl factory and has no body until $.build", () => {
  let ran = false
  const builder = fn("f", {
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      ran = true
      return x
    },
  })
  const iterator = builder[Symbol.iterator]()
  const { value, done } = iterator.next()
  assert.equal(done, false)
  const declaration = value as $.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal("impl" in declaration, true)
  assert.equal(declaration.body, undefined)
  assert.equal(ran, false)

  const program = $.build(function*() {
    yield* builder
    return null
  })
  const built = program.statements[0] as $.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal(built.impl, undefined)
  assert.equal((built.body as { readonly kind: string }).kind, "block")
  assert.equal(ran, true)
})

test("multiple forward references materialize a function body once per build", () => {
  let runs = 0
  const builder = fn("last", {
    body: function*() {
      runs++
      return $.number(1)
    },
  })
  const build = () =>
    $.build(function*() {
      yield* fn("first", {
        body: function*() {
          return $.add($.call(last), $.call(last))
        },
      })
      yield* fn("second", {
        body: function*() {
          return $.call(last)
        },
      })
      const last = yield* builder
      return last
    })

  assert.equal(runs, 0)
  const program = build()
  assert.equal(runs, 1)
  for (const statement of program.statements) {
    assert.equal(statement.kind, "function-declaration")
    if (statement.kind === "function-declaration") assert.deepEqual(statement.type?.return, $.Number)
  }
  const code = "function first() {\n  return last() + last();\n}\n"
    + "function second() {\n  return last();\n}\n"
    + "function last() {\n  return 1;\n}"
  assert.equal(emitProgram(program), code)
  assert.equal(emitProgram(build()), code)
  assert.equal(runs, 2)
})

test("arrows stay eager: the body is materialized at construction", () => {
  const arrow = $.arrow({
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      return x
    },
  })
  assert.equal((arrow as { readonly impl?: unknown }).impl, undefined)
  assert.equal((arrow.body as { readonly kind: string }).kind, "block")
})

test("self-recursion: fibonacci calls itself through the captured ref", () => {
  const program = $.build(function*() {
    const fib: $.FnRef<[$.Param<"n", number>], number, []> = yield* fn("fib", {
      params: [$.param("n", $.Number)],
      returns: $.Number,
      body: function*({ n }) {
        yield* $.if($.binary("<", n, $.number(2)), function*() {
          yield* $.return(n)
        })
        return $.binary(
          "+",
          $.call(fib, $.binary("-", n, $.number(1))),
          $.call(fib, $.binary("-", n, $.number(2))),
        )
      },
    })
    return fib
  })

  const code = emitProgram(program)
  assert.match(code, /function fib\(n: number\): number/)
  assert.match(code, /fib\(n - 1\) \+ fib\(n - 2\)/)

  const declaration = program.statements[0] as $.BuiltFunction
  const body = declaration.body!
  const returned = body.statements[body.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly kind: string; readonly left: { readonly callee: { readonly kind: string; readonly nameHint: string } } }
  }
  assert.equal(returned.kind, "return")
  assert.equal(returned.value.kind, "binary")
  assert.equal(returned.value.left.callee.kind, "ref")
  assert.equal(returned.value.left.callee.nameHint, "fib")
})

test("mutual recursion: even and odd resolve forward edges through captured refs", () => {
  const program = $.build(function*() {
    const even: $.FnRef<[$.Param<"n", number>], boolean, []> = yield* fn("even", {
      params: [$.param("n", $.Number)],
      returns: $.Boolean,
      body: function*({ n }) {
        yield* $.if($.binary("===", n, $.number(0)), function*() {
          yield* $.return($.boolean(true))
        })
        return $.call(odd, $.binary("-", n, $.number(1)))
      },
    })

    const odd: $.FnRef<[$.Param<"n", number>], boolean, []> = yield* fn("odd", {
      params: [$.param("n", $.Number)],
      returns: $.Boolean,
      body: function*({ n }) {
        yield* $.if($.binary("===", n, $.number(0)), function*() {
          yield* $.return($.boolean(false))
        })
        return $.call(even, $.binary("-", n, $.number(1)))
      },
    })

    return even
  })

  const evenDecl = program.statements[0] as $.BuiltFunction
  const evenCall = evenDecl.body!.statements[evenDecl.body!.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly callee: { readonly nameHint: string } }
  }
  assert.equal(evenCall.value.callee.nameHint, "odd")

  const oddDecl = program.statements[1] as $.BuiltFunction
  const oddCall = oddDecl.body!.statements[oddDecl.body!.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly callee: { readonly nameHint: string } }
  }
  assert.equal(oddCall.value.callee.nameHint, "even")

  const code = emitProgram(program)
  assert.match(code, /function even\(n: number\): boolean/)
  assert.match(code, /return odd\(n - 1\)/)
  assert.match(code, /function odd\(n: number\): boolean/)
  assert.match(code, /return even\(n - 1\)/)
})
