import assert from "node:assert/strict"
import { test } from "node:test"

import { const as constBinding, let as letBinding, type as typeBinding } from "../src/declaration.ts"
import { nullLiteral as nullExpr, typeof as typeofExpr } from "../src/expr.ts"
import { in as inGuard, isTypeof as typeofGuard } from "../src/guard.ts"
import * as T from "../src/index.ts"
import {
  break as breakStatement,
  continue as continueStatement,
  do as doStatement,
  else as elseClause,
  if as ifStatement,
  return as returnStatement,
  throw as throwStatement,
  while as whileStatement,
} from "../src/statement.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram as emitTypeScript } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("keyword exports reach the flat public API without suffixed aliases", () => {
  const members = {
    let: letBinding,
    const: constBinding,
    type: typeBinding,
    nullLiteral: nullExpr,
    typeof: typeofExpr,
    isTypeof: typeofGuard,
    in: inGuard,
    return: returnStatement,
    throw: throwStatement,
    do: doStatement,
    break: breakStatement,
    continue: continueStatement,
    if: ifStatement,
    else: elseClause,
    while: whileStatement,
  }
  for (const [name, value] of Object.entries(members)) {
    assert.ok(Object.entries(T).some(([member, exported]) => member === name && exported === value), name)
    assert.equal(Object.hasOwn(T, `${name}_`), false)
  }
})

test("the primitive object type stays distinct from the object constructor", () => {
  assert.equal(T.NonPrimitive.kind, "primitive")
  assert.equal(T.NonPrimitive.name, "object")
  assert.equal(T.Object({ value: T.Number }).kind, "object")
})

test("keyword named imports preserve denotations, emission, and execution", () => {
  const program = T.build(function*() {
    yield* typeBinding("Count", T.Number)
    const count = yield* letBinding("count", 1, T.Number)
    const offset = yield* constBinding("offset", 2)
    yield* T.fn("sum", {
      params: [],
      body: function*() {
        yield* ifStatement(T.gt(count, 0), function*() {
          yield* returnStatement(T.add(count, offset))
        })
        return 0
      },
    })
    return count
  })
  expectTypeOf<T.Denotes<typeof program.result>>(null as never).toEqualTypeOf<number>()
  assert.equal(
    emitTypeScript(program),
    "type Count = number;\nlet count: number = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}",
  )
  const javascript = emitJavaScript(program)
  assert.equal(javascript, "let count = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}")
  assert.equal(new Function(`${javascript}\nreturn sum();`)(), 3)
})
