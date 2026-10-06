import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../src/index.ts"

import { emitProgram } from "../targets/ts.ts"

const fn = T.fn

test("a yielded function declaration keeps its impl factory and has no body until T.build", () => {
  let ran = false
  const builder = fn("f", {
    params: [T.param("x", T.Number)],
    body: function*({ x }) {
      ran = true
      return x
    },
  })
  const iterator = builder[Symbol.iterator]()
  const { value, done } = iterator.next()
  assert.equal(done, false)
  const declaration = value as T.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal("impl" in declaration, true)
  assert.equal(declaration.body, undefined)
  assert.equal(ran, false)

  const program = T.build(function*() {
    yield* builder
    return null
  })
  const built = program.statements[0] as T.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal(built.impl, undefined)
  assert.equal((built.body as { readonly kind: string }).kind, "block")
  assert.equal(ran, true)
})

test("arrows stay eager: the body is materialized at construction", () => {
  const arrow = T.arrow({
    params: [T.param("x", T.Number)],
    body: function*({ x }) {
      return x
    },
  })
  assert.equal((arrow as { readonly impl?: unknown }).impl, undefined)
  assert.equal((arrow.body as { readonly kind: string }).kind, "block")
})

test("self-recursion: fibonacci calls itself through the captured ref", () => {
  const program = T.build(function*() {
    const fib: T.FnRef<[T.Param<"n", number>], number, []> = yield* fn("fib", {
      params: [T.param("n", T.Number)],
      returns: T.Number,
      body: function*({ n }) {
        yield* T.if(T.binary("<", n, T.numberLiteral(2)), function*() {
          yield* T.return(n)
        })
        return T.binary(
          "+",
          T.call(fib, T.binary("-", n, T.numberLiteral(1))),
          T.call(fib, T.binary("-", n, T.numberLiteral(2))),
        )
      },
    })
    return fib
  })

  const code = emitProgram(program)
  assert.match(code, /function fib\(n: number\): number/)
  assert.match(code, /fib\(n - 1\) \+ fib\(n - 2\)/)

  const declaration = program.statements[0] as T.BuiltFunction
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
  const program = T.build(function*() {
    const even: T.FnRef<[T.Param<"n", number>], boolean, []> = yield* fn("even", {
      params: [T.param("n", T.Number)],
      returns: T.Boolean,
      body: function*({ n }) {
        yield* T.if(T.binary("===", n, T.numberLiteral(0)), function*() {
          yield* T.return(T.booleanLiteral(true))
        })
        return T.call(odd, T.binary("-", n, T.numberLiteral(1)))
      },
    })

    const odd: T.FnRef<[T.Param<"n", number>], boolean, []> = yield* fn("odd", {
      params: [T.param("n", T.Number)],
      returns: T.Boolean,
      body: function*({ n }) {
        yield* T.if(T.binary("===", n, T.numberLiteral(0)), function*() {
          yield* T.return(T.booleanLiteral(false))
        })
        return T.call(even, T.binary("-", n, T.numberLiteral(1)))
      },
    })

    return even
  })

  const evenDecl = program.statements[0] as T.BuiltFunction
  const evenCall = evenDecl.body!.statements[evenDecl.body!.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly callee: { readonly nameHint: string } }
  }
  assert.equal(evenCall.value.callee.nameHint, "odd")

  const oddDecl = program.statements[1] as T.BuiltFunction
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
