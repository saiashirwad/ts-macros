import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { emitProgram } from "../targets/ts.ts"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T

test("plain final returns preserve unions but widen a lone literal", () => {
  const program = T.build(function*() {
    const grade = yield* T.fn("grade", {
      params: [T.param("b", T.Boolean)],
      body: function*({ b }) {
        yield* T.if(b, function*() {
          yield* T.return("A")
        })
        return "B"
      },
    })
    type Grade = Check<Equal<T.Denotes<typeof grade>, (b: boolean) => "A" | "B">>
    const single = yield* T.fn("single", {
      body: function*() {
        return "A"
      },
    })
    type Single = Check<Equal<T.Denotes<typeof single>, () => string>>
    const declared = yield* T.fn("declared", {
      returns: T.String,
      body: function*() {
        return "A"
      },
    })
    type Declared = Check<Equal<T.Denotes<typeof declared>, () => string>>
    const checks: [Grade, Single, Declared] = [true, true, true]
    void checks
    return { grade, single, declared }
  })
  assert.match(emitProgram(program), /return "A";\n  }\n  return "B";/)
})

const invalidReturns = () => {
  const final = T.fn("badFinal", {
    returns: T.Number,
    body: function*() {
      return "A"
    },
  })
  type Final = Check<Equal<typeof final, FailedCheck<["the returned value", "A", "is not assignable to", number]>>>
  const early = T.fn("badEarly", {
    returns: T.Number,
    body: function*() {
      yield* T.return("A")
      return 1
    },
  })
  type Early = Check<Equal<typeof early, FailedCheck<["early returns", "A", "do not satisfy the declared return type", number]>>>
  const lift = T.fn("badLift", {
    body: function*() {
      return () => 1
    },
  })
  type Lift = Check<Equal<typeof lift, FailedCheck<["cannot lift", () => 1]>>>
  const checks: [Final, Early, Lift] = [true, true, true]
  void checks
}
void invalidReturns
