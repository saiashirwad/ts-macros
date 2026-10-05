import assert from "node:assert/strict"
import { test } from "node:test"
import type { FailedCheck } from "../src/check.ts"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("arrow infers a parameter-dependent body without casts", () => {
  const grade = Expr.arrow({
    params: [Expr.param("b", Type.boolean)],
    body: function*({ b }) {
      yield* Stmt.if(b, function*() {
        yield* Stmt.return("A")
      })
      return "B"
    },
  })
  expectTypeOf<Expr.Denotes<typeof grade>>(null as never).toEqualTypeOf<(b: boolean) => "A" | "B">()
  const single = Expr.arrow({
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<Expr.Denotes<typeof single>>(null as never).toEqualTypeOf<() => string>()
  const program = Program.build(function*() {
    return yield* Decl.const("grade", grade)
  })
  assert.equal(emitProgram(program), "const grade = (b: boolean) => {\n  if (b) {\n    return \"A\";\n  }\n  return \"B\";\n};")
})

test("arrows honor the function spec's return annotation and type parameters", () => {
  const T = Type.param("T")
  const identity = Expr.arrow({
    typeParams: [T],
    params: [Expr.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const program = Program.build(function*() {
    const result = yield* Decl.const("result", Expr.call(Expr.instantiate(identity, Type.number), 1))
    expectTypeOf<Expr.Denotes<typeof result>>(null as never).toEqualTypeOf<number>()
    return result
  })
  assert.equal(
    emitProgram(program),
    "const result = (<T>(value: T): T => {\n  return value;\n})<number>(1);",
  )
})

const invalidArrows = () => {
  const badLift = Expr.arrow({
    body: function*() {
      return () => 1
    },
  })
  expectTypeOf<typeof badLift>(null as never).toEqualTypeOf<FailedCheck<["cannot lift", () => 1]>>()
  // @ts-expect-error an error result cannot initialize a binding
  Decl.const("bad", badLift)
  // @ts-expect-error an error result cannot be called
  Expr.call(badLift)
  const badFinal = Expr.arrow({
    returns: Type.number,
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<typeof badFinal>(null as never).toEqualTypeOf<FailedCheck<["the returned value", "A", "is not assignable to", number]>>()
  const badEarly = Expr.arrow({
    returns: Type.number,
    body: function*() {
      yield* Stmt.return("A")
      return 1
    },
  })
  expectTypeOf<typeof badEarly>(null as never).toEqualTypeOf<FailedCheck<["early returns", "A", "do not satisfy the declared return type", number]>>()
  // @ts-expect-error an error result cannot be returned as an expression
  Stmt.return(badFinal)
  // @ts-expect-error required parameters cannot follow optional ones
  Expr.arrow({
    params: [Expr.optional("x", Type.number), Expr.param("y", Type.number)],
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error duplicate type parameter names
  Expr.arrow({
    typeParams: [Type.param("T"), Type.param("T")],
    body: function*() {
      return 1
    },
  })
}
void invalidArrows
