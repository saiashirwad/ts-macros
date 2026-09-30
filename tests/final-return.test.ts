import assert from "node:assert/strict"
import { test } from "node:test"

import type { FailedCheck } from "../src/check.ts"
import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T

test("plain final returns preserve unions but widen a lone literal", () => {
  const program = Program.build(function*() {
    const grade = yield* Decl.fn("grade", {
      params: [Expr.param("b", Type.boolean)],
      body: function*({ b }) {
        yield* Stmt.if_(b, function*() {
          yield* Stmt.return_("A")
        })
        return "B"
      },
    })
    type Grade = Check<Equal<Expr.Denotes<typeof grade>, (b: boolean) => "A" | "B">>
    const single = yield* Decl.fn("single", {
      body: function*() {
        return "A"
      },
    })
    type Single = Check<Equal<Expr.Denotes<typeof single>, () => string>>
    const declared = yield* Decl.fn("declared", {
      returns: Type.string,
      body: function*() {
        return "A"
      },
    })
    type Declared = Check<Equal<Expr.Denotes<typeof declared>, () => string>>
    const checks: [Grade, Single, Declared] = [true, true, true]
    void checks
    return { grade, single, declared }
  })
  assert.match(emitProgram(program), /return "A";\n  }\n  return "B";/)
})

const invalidReturns = () => {
  const final = Decl.fn("badFinal", {
    returns: Type.number,
    body: function*() {
      return "A"
    },
  })
  type Final = Check<Equal<typeof final, FailedCheck<["the returned value", "A", "is not assignable to", number]>>>
  const early = Decl.fn("badEarly", {
    returns: Type.number,
    body: function*() {
      yield* Stmt.return_("A")
      return 1
    },
  })
  type Early = Check<Equal<typeof early, FailedCheck<["early returns", "A", "do not satisfy the declared return type", number]>>>
  const lift = Decl.fn("badLift", {
    body: function*() {
      return () => 1
    },
  })
  type Lift = Check<Equal<typeof lift, FailedCheck<["cannot lift", () => 1]>>>
  const checks: [Final, Early, Lift] = [true, true, true]
  void checks
}
void invalidReturns
