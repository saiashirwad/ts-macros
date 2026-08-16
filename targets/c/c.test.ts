import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as FFI from "../../src/ffi.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"
import { emitProgramTypeScript } from "../typescript/index.ts"
import { emitProgramC, int } from "./index.ts"

test("the Int nominal erases to number through the TS emitters", () => {
  const program = Program.build(function*() {
    const twice = yield* Fn.Function("twice").pipe(
      Fn.Params(Fn.Param("x", int())),
      Fn.Returns(int()),
      Fn.Impl(function*({ x }) {
        return Expr.Binary("+", x, x)
      }),
    )
    return twice
  })

  // the C target keeps spelling Int as int; a target that has never heard
  // of Int reads the erasure the nominal carries
  assert.equal(
    emitProgramTypeScript(program),
    `function twice(x: number): number {
  return x + x;
}`,
  )
})

test("c target hoists a prototype for a function called before its declaration", () => {
  const program = Program.build(function*() {
    const main = yield* Fn.Function("main").pipe(
      Fn.Returns(int()),
      Fn.Impl(function*() {
        return Fn.Call(greet)
      }),
    )
    const greet: Fn.FunctionRef<[], number> = yield* Fn.Function("greet").pipe(
      Fn.Returns(int()),
      Fn.Impl(function*() {
        return Expr.Number(1)
      }),
    )
    return main
  })

  assert.equal(
    emitProgramC(program),
    `int greet(void);
int main(void) {
  return greet();
}
int greet(void) {
  return 1;
}`,
  )
})

test("c target emits annotated functions and bindings", () => {
  const program = Program.build(function*() {
    const clamp = yield* Fn.Function("clamp").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Returns(Type.Number()),
      Fn.Impl(function*({ x }) {
        yield* Stmt.If(Expr.Binary(">", x, Expr.Number(100)), function*() {
          yield* Stmt.Return(Expr.Number(100))
        })
        return x
      }),
    )
    const limit = yield* Binding.Const("limit").pipe(Binding.Init(Fn.Call(clamp, Expr.Number(150))))
    return limit
  })

  assert.equal(
    emitProgramC(program),
    `double clamp(double x) {
  if (x > 100) {
    return 100;
  }
  return x;
}
const double limit = clamp(150);`,
  )
})

test("c target infers binding and return types when annotations are absent", () => {
  const program = Program.build(function*() {
    const clamp = yield* Fn.Function("clamp").pipe(
      Fn.Params(Fn.Param("x", Type.Number())),
      Fn.Impl(function*({ x }) {
        yield* Stmt.If(Expr.Binary(">", x, Expr.Number(100)), function*() {
          yield* Stmt.Return(Expr.Number(100))
        })
        return x
      }),
    )
    const capped = yield* Binding.Const("capped").pipe(Binding.Init(Fn.Call(clamp, Expr.Number(150))))
    const message = yield* Binding.Let("message").pipe(Binding.Init(Expr.String("ok")))
    const high = yield* Binding.Let("high").pipe(Binding.Init(Expr.Binary(">", capped, Expr.Number(99))))
    return high
  })

  assert.equal(
    emitProgramC(program),
    `double clamp(double x) {
  if (x > 100) {
    return 100;
  }
  return x;
}
const double capped = clamp(150);
const char *message = "ok";
bool high = capped > 99;`,
  )
})

test("c target spells prop access with an arrow and equality without triple equals", () => {
  const point = FFI.Value<{ x: number }>("point")
  const program = Program.build(function*() {
    const same = yield* Binding.Const("same").pipe(Binding.Init(Expr.Binary("===", Expr.Prop(point, "x"), Expr.Number(3))))
    return same
  })

  assert.equal(emitProgramC(program), "const bool same = point->x == 3;")
})

test("c target resolves erased leaves through an oracle", () => {
  const program = Program.build(function*() {
    const rate = yield* Binding.Const("rate").pipe(Binding.Init(Expr.Binary("*", FFI.Value<number>("lr"), Expr.Number(2))))
    return rate
  })

  assert.throws(() => emitProgramC(program), /cannot infer a C type for "rate" — annotate it/)
  assert.equal(
    emitProgramC(program, { varRef: (node) => (node.name === "lr" ? Type.Number() : null) }),
    "const double rate = lr * 2;",
  )
})

test("c target rejects node kinds with no C spelling", () => {
  const throwsOn = (body: () => Generator<any, any, unknown>, message: RegExp) => assert.throws(() => emitProgramC(Program.build(body)), message)

  throwsOn(function*() {
    yield* Stmt.Do(Expr.Template(["a", "b"], Expr.String("x")))
    return Expr.Number(0)
  }, /c target: no template literals/)

  throwsOn(function*() {
    yield* Stmt.ForOf("item", FFI.Value<number[]>("items"), function*() {
      yield* Stmt.Break()
    })
    return Expr.Number(0)
  }, /c target: no for-of/)

  throwsOn(function*() {
    const fs = FFI.Import<{ readonly readFileSync: (path: string) => string }>("node:fs", "fs")
    const data = yield* Binding.Const("data").pipe(Binding.Init(Expr.Prop(fs, "readFileSync")))
    return data
  }, /c target: no module imports/)

  throwsOn(function*() {
    const mystery = yield* Fn.Function("mystery").pipe(
      Fn.Impl(function*() {
        return FFI.Value<number>("unknowable")
      }),
    )
    return mystery
  }, /cannot infer a C type for function "mystery" — annotate its return type/)
})
