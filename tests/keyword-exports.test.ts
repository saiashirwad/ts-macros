import assert from "node:assert/strict"
import { test } from "node:test"

import { const as constBinding, let as letBinding, type as typeBinding } from "../src/declaration.ts"
import { null as nullExpr, typeof as typeofExpr } from "../src/expr.ts"
import { in as inGuard, isTypeof as typeofGuard } from "../src/guard.ts"
import * as $ from "../src/index.ts"
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
    null: nullExpr,
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
    assert.ok(Object.entries($).some(([member, exported]) => member === name && exported === value), name)
    assert.equal(Object.hasOwn($, `${name}_`), false)
  }
})

test("the primitive object type stays distinct from the object constructor", () => {
  assert.equal($.NonPrimitive.kind, "primitive")
  assert.equal($.NonPrimitive.name, "object")
  assert.equal($.Object({ value: $.Number }).kind, "object")
})

test("keyword named imports preserve denotations, emission, and execution", () => {
  const program = $.build(function*() {
    yield* typeBinding("Count", $.Number)
    const count = yield* letBinding("count", 1, $.Number)
    const offset = yield* constBinding("offset", 2)
    yield* $.fn("sum", {
      params: [],
      body: function*() {
        yield* ifStatement($.gt(count, 0), function*() {
          yield* returnStatement($.add(count, offset))
        })
        return 0
      },
    })
    return count
  })
  expectTypeOf<$.Denotes<typeof program.result>>(null as never).toEqualTypeOf<number>()
  assert.equal(
    emitTypeScript(program),
    "type Count = number;\nlet count: number = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}",
  )
  const javascript = emitJavaScript(program)
  assert.equal(javascript, "let count = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}")
  assert.equal(new Function(`${javascript}\nreturn sum();`)(), 3)
})
