import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import { synthesize } from "../src/emit/index.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgramC, insertFrees, type Owned, owned } from "../targets/c/index.ts"

function* dupDeclaration() {
  return yield* Fn.Function("dup").pipe(
    Fn.Params(Fn.Param("text", Type.String())),
    Fn.Returns(owned(Type.String())),
    Fn.Impl(function*({ text }) {
      return Fn.Call(FFI.Value<(text: string) => Owned<string>>("strdup"), text)
    }),
  )
}

const DUP = `char *dup(const char *text) {
  return strdup(text);
}`

test("owned bindings free after their last use", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("hi"))))
    yield* Stmt.Do(Fn.Call(FFI.Value<any>("puts"), s))
    yield* Stmt.Do(Fn.Call(FFI.Value<any>("done")))
    return Expr.Number(0)
  })

  assert.equal(
    emitProgramC(program),
    `${DUP}
char *s = dup("hi");
puts(s);
free(s);
done();`,
  )
})

test("early returns free live owned values on their own path", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const check = yield* Fn.Function("check").pipe(
      Fn.Params(Fn.Param("cond", Type.Boolean())),
      Fn.Impl(function*({ cond }) {
        const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("x"))))
        yield* Stmt.If(cond, function*() {
          yield* Stmt.Return(Expr.Number(0))
        })
        yield* Stmt.Do(Fn.Call(FFI.Value<any>("puts"), s))
        return Expr.Number(0)
      }),
    )
    return check
  })

  assert.equal(
    emitProgramC(program),
    `${DUP}
double check(bool cond) {
  char *s = dup("x");
  if (cond) {
    free(s);
    return 0;
  }
  puts(s);
  free(s);
  return 0;
}`,
  )
})

test("returning an owned binding moves it to the caller", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const make = yield* Fn.Function("make").pipe(
      Fn.Impl(function*() {
        const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("y"))))
        return s
      }),
    )
    return make
  })

  assert.equal(
    emitProgramC(program),
    `${DUP}
char *make(void) {
  char *s = dup("y");
  return s;
}`,
  )
})

test("an owned value never used still frees at block end", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const tmp = yield* Binding.Const("tmp").pipe(Binding.Init(Fn.Call(dup, Expr.String("q"))))
    yield* Stmt.Do(Fn.Call(FFI.Value<any>("done")))
    return tmp
  })

  assert.equal(
    emitProgramC(program),
    `${DUP}
char *tmp = dup("q");
done();
free(tmp);`,
  )
})

test("compound returns of owned values are rejected", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const bad = yield* Fn.Function("bad").pipe(
      Fn.Impl(function*() {
        const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("z"))))
        return Fn.Call(FFI.Value<any>("strlen"), s)
      }),
    )
    return bad
  })

  assert.throws(() => emitProgramC(program), /ownership: "s" is used in a return value — bind the result/)
})

test("breaking while owned values are live is rejected", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const loop = yield* Fn.Function("loop").pipe(
      Fn.Impl(function*() {
        const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("w"))))
        yield* Stmt.While(Expr.Boolean(true), function*() {
          yield* Stmt.Break()
        })
        yield* Stmt.Do(Fn.Call(FFI.Value<any>("puts"), s))
        return Expr.Number(0)
      }),
    )
    return loop
  })

  assert.throws(() => emitProgramC(program), /ownership: cannot break while owned values are live/)
})

test("owned(t, free) names the release function; the default policy spells it as a call", () => {
  const program = Program.build(function*() {
    const dup = yield* Fn.Function("dup").pipe(
      Fn.Params(Fn.Param("text", Type.String())),
      Fn.Returns(owned(Type.String(), "strfree")),
      Fn.Impl(function*({ text }) {
        return Fn.Call(FFI.Value<(text: string) => Owned<string, "strfree">>("strdup"), text)
      }),
    )
    const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("hi"))))
    yield* Stmt.Do(Fn.Call(FFI.Value<any>("puts"), s))
    return Expr.Number(0)
  })

  assert.equal(
    emitProgramC(program),
    `char *dup(const char *text) {
  return strdup(text);
}
char *s = dup("hi");
puts(s);
strfree(s);`,
  )
})

test("a custom free policy replaces the default release call", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const s = yield* Binding.Const("s").pipe(Binding.Init(Fn.Call(dup, Expr.String("hi"))))
    yield* Stmt.Do(Fn.Call(FFI.Value<any>("puts"), s))
    return Expr.Number(0)
  })

  const calls: string[] = []
  const lowered = insertFrees(program.statements, synthesize(program.statements), (flavor, name) => {
    calls.push(`${flavor}:${name}`)
    return Stmt.Do(Fn.Call(FFI.Value<any>("release"), FFI.Value(name)))
  })

  assert.deepEqual(calls, ["free:s"])
  assert.equal(lowered.length, 4)
})
