import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../../src/$.ts"
import { synthesize } from "../../src/emit/index.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"
import { emitProgramC, insertFrees, type Owned, owned } from "./index.ts"

function* dupDeclaration() {
  return yield* $.Function("dup").pipe(
    $.Params($.Param("text", Type.String())),
    $.Returns(owned(Type.String())),
    $.Impl(function*({ text }) {
      return $.Call($.Value<(text: string) => Owned<string>>("strdup"), text)
    }),
  )
}

const DUP = `char *dup(const char *text) {
  return strdup(text);
}`

test("owned bindings free after their last use", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const s = yield* $.Const("s", dup("hi"))
    yield* $.Do($.Call($.Value<any>("puts"), s))
    yield* $.Do($.Call($.Value<any>("done")))
    return $.norm(0)
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
    const check = yield* $.fun("check", [$.Param("cond", Type.Boolean())], function*({ cond }) {
      const s = yield* $.Const("s", dup("x"))
      yield* $.If(cond, function*() {
        yield* $.Return(0)
      })
      yield* $.Do($.Call($.Value<any>("puts"), s))
      return $.norm(0)
    })
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
    const make = yield* $.fun("make", [], function*() {
      const s = yield* $.Const("s", dup("y"))
      return s
    })
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
    const tmp = yield* $.Const("tmp", dup("q"))
    yield* $.Do($.Call($.Value<any>("done")))
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
    const bad = yield* $.fun("bad", [], function*() {
      const s = yield* $.Const("s", dup("z"))
      return $.Call($.Value<any>("strlen"), s)
    })
    return bad
  })

  assert.throws(() => emitProgramC(program), /ownership: "s" is used in a return value — bind the result/)
})

test("breaking while owned values are live is rejected", () => {
  const program = Program.build(function*() {
    const dup = yield* dupDeclaration()
    const loop = yield* $.fun("loop", [], function*() {
      const s = yield* $.Const("s", dup("w"))
      yield* $.While(true, function*() {
        yield* $.Break()
      })
      yield* $.Do($.Call($.Value<any>("puts"), s))
      return $.norm(0)
    })
    return loop
  })

  assert.throws(() => emitProgramC(program), /ownership: cannot break while owned values are live/)
})

test("owned(t, free) names the release function; the default policy spells it as a call", () => {
  const program = Program.build(function*() {
    const dup = yield* $.Function("dup").pipe(
      $.Params($.Param("text", Type.String())),
      $.Returns(owned(Type.String(), "strfree")),
      $.Impl(function*({ text }) {
        return $.Call($.Value<(text: string) => Owned<string, "strfree">>("strdup"), text)
      }),
    )
    const s = yield* $.Const("s", dup("hi"))
    yield* $.Do($.Call($.Value<any>("puts"), s))
    return $.norm(0)
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
    const s = yield* $.Const("s", dup("hi"))
    yield* $.Do($.Call($.Value<any>("puts"), s))
    return $.norm(0)
  })

  const calls: string[] = []
  const lowered = insertFrees(program.statements, synthesize(program.statements), (flavor, name) => {
    calls.push(`${flavor}:${name}`)
    return $.Do($.Call($.Value<any>("release"), $.Value(name)))
  })

  assert.deepEqual(calls, ["free:s"])
  assert.equal(lowered.length, 4)
})
