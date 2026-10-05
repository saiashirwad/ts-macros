import assert from "node:assert/strict"
import { test } from "node:test"

import { const as constBinding, let as letBinding, type as typeBinding } from "../src/declaration.ts"
import { null as nullExpr, typeof as typeofExpr } from "../src/expr.ts"
import { in as inGuard, typeof as typeofGuard } from "../src/guard.ts"
import { Decl, Expr, Guard, Program, Stmt, Type } from "../src/index.ts"
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
import {
  infer as inferType,
  keyof as keyofType,
  null as nullType,
  readonly as readonlyField,
  undefined as undefinedType,
  void as voidType,
} from "../src/types/index.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram as emitTypeScript } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("keyword exports reach public namespaces without suffixed aliases", () => {
  const exports = [
    { namespace: Decl, members: { let: letBinding, const: constBinding, type: typeBinding } },
    { namespace: Expr, members: { null: nullExpr, typeof: typeofExpr } },
    { namespace: Guard, members: { typeof: typeofGuard, in: inGuard } },
    {
      namespace: Stmt,
      members: {
        return: returnStatement,
        throw: throwStatement,
        do: doStatement,
        break: breakStatement,
        continue: continueStatement,
        if: ifStatement,
        else: elseClause,
        while: whileStatement,
      },
    },
    {
      namespace: Type,
      members: { undefined: undefinedType, null: nullType, void: voidType, readonly: readonlyField, keyof: keyofType, infer: inferType },
    },
  ]
  for (const { namespace, members } of exports) {
    for (const [name, value] of Object.entries(members)) {
      assert.ok(Object.entries(namespace).some(([member, exported]) => member === name && exported === value), name)
      assert.equal(Object.hasOwn(namespace, `${name}_`), false)
    }
  }
})

test("the primitive object type stays distinct from the object constructor", () => {
  assert.equal(Type.object_.kind, "primitive")
  assert.equal(Type.object_.name, "object")
  assert.equal(Type.object({ value: Type.number }).kind, "object")
})

test("keyword named imports preserve denotations, emission, and execution", () => {
  const program = Program.build(function*() {
    yield* typeBinding("Count", Type.number)
    const count = yield* letBinding("count", 1, Type.number)
    const offset = yield* constBinding("offset", 2)
    yield* Decl.fn("sum", {
      params: [],
      body: function*() {
        yield* ifStatement(Expr.gt(count, 0), function*() {
          yield* returnStatement(Expr.add(count, offset))
        })
        return 0
      },
    })
    return count
  })
  expectTypeOf<Expr.Denotes<typeof program.result>>(null as never).toEqualTypeOf<number>()
  assert.equal(
    emitTypeScript(program),
    "type Count = number;\nlet count: number = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}",
  )
  const javascript = emitJavaScript(program)
  assert.equal(javascript, "let count = 1;\nconst offset = 2;\nfunction sum() {\n  if (count > 0) {\n    return count + offset;\n  }\n  return 0;\n}")
  assert.equal(new Function(`${javascript}\nreturn sum();`)(), 3)
})
