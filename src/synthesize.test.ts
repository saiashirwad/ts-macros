import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import type * as Binding from "./binding.ts"
import { synthesize, typeExprToText } from "./emit/index.ts"
import type * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import * as Program from "./program.ts"
import type { Statement } from "./statement.ts"
import * as Type from "./types/index.ts"

const initOf = (statement: Statement) => (statement as Binding.BindingDeclaration).expr!

const textOf = (type: Type.TypeExpr<any> | null): string | null => (type === null ? null : typeExprToText(type))

test("bindings infer from initializers through calls", () => {
  const program = Program.build(function*() {
    const twice = yield* $.fun("twice", [$.Param("x", Type.Number())], function*({ x }) {
      return $.mul(x, 2)
    })
    const limit = yield* $.Const("limit", twice(4))
    const flag = yield* $.Let("flag", $.gt(twice(4), 5))
    return $.norm([limit, flag])
  })

  const types = synthesize(program.statements)
  assert.equal(textOf(types.tryTypeOf(initOf(program.statements[1]!))), "number")
  assert.equal(textOf(types.tryTypeOf(initOf(program.statements[2]!))), "boolean")
})

test("function return types infer from bodies, joining branches", () => {
  const program = Program.build(function*() {
    const pick = yield* $.fun("pick", [$.Param("n", Type.Number())], function*({ n }) {
      yield* $.If($.gt(n, 0), function*() {
        yield* $.Return("big")
      })
      return $.norm(0)
    })
    return pick
  })

  const types = synthesize(program.statements)
  const declaration = program.statements[0] as Fn.FunctionDeclaration<any, any, any>
  assert.equal(textOf(types.typeOfFunction(declaration)), "(arg0: number) => string | number")
})

test("generic instantiation substitutes type arguments at runtime", () => {
  const T = Type.Param("T")
  const program = Program.build(function*() {
    const identity = yield* $.Function("identity").pipe(
      $.TypeParams(T),
      $.Params($.Param("a", T)),
      $.Impl(function*({ a }) {
        return a
      }),
    )
    const n = yield* $.Const("n", $.Call($.Instantiate(identity, Type.Number()), $.Number(2)))
    return n
  })

  const types = synthesize(program.statements)
  assert.equal(textOf(types.tryTypeOf(initOf(program.statements[1]!))), "number")
})

test("nominal refs carry domain types through substitution", () => {
  const S = Type.Param("S")
  const tensor = <A extends Type.TypeExpr<any>>(shape: A) => Type.Ref("Tensor", shape)
  const program = Program.build(function*() {
    const relu = yield* $.Function("relu").pipe(
      $.TypeParams(S),
      $.Params($.Param("t", tensor(S))),
      $.Returns(tensor(S)),
    )
    const out = yield* $.Const(
      "out",
      $.Call($.Instantiate(relu, Type.Tuple(Type.Literal(64), Type.Literal(128))), $.Value<any>("t0")),
    )
    return out
  })

  const types = synthesize(program.statements)
  assert.equal(textOf(types.tryTypeOf(initOf(program.statements[1]!))), "Tensor<[64, 128]>")
})

test("an oracle resolves leaves the tree cannot see", () => {
  const program = Program.build(function*() {
    const rate = yield* $.Const("rate", $.mul($.ref<number>("lr"), 2))
    return rate
  })

  const blind = synthesize(program.statements)
  assert.equal(blind.tryTypeOf(initOf(program.statements[0]!)), null)

  const sighted = synthesize(program.statements, {
    varRef: (node) => (node.name === "lr" ? Type.Number() : null),
  })
  assert.equal(textOf(sighted.tryTypeOf(initOf(program.statements[0]!))), "number")
})

test("let widens literal initializers, const keeps them", () => {
  const program = Program.build(function*() {
    const grade = yield* $.Let("grade", "F")
    const tag = yield* $.Const("tag", "ok")
    yield* $.Assign(grade, "A")
    return $.norm([grade, tag])
  })

  const types = synthesize(program.statements)
  const gradeRef = (program.statements[2] as Expr.Assign<any, any>).target
  assert.equal(textOf(types.tryTypeOf(gradeRef)), "string")
  assert.equal(textOf(types.tryTypeOf(initOf(program.statements[1]!))), "\"ok\"")
})
