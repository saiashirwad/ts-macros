import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Guard, Program, Stmt, Type } from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"
import type { Equal } from "./typing.ts"
import { expectTypeOf } from "./typing.ts"

test("ifGuard introduces a fresh annotated const without retyping the subject", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*(narrowed) {
          const exact: Equal<Expr.Denotes<typeof narrowed>, string> = true
          void exact
          expectTypeOf<Expr.Denotes<typeof input>>().toEqualTypeOf<unknown>()
          assert.notEqual(input.id, narrowed.id)
          assert.equal(narrowed.mutable, false)
          yield* Stmt.return(narrowed)
        })
        return "fallback"
      },
    })
  })
  assert.equal(
    emitProgram(program),
    `function read(input: unknown) {
  if (typeof input === "string") {
    const input_2: string = input;
    return input_2;
  }
  return "fallback";
}`,
  )
  assert.equal(
    emitJavaScript(program),
    `function read(input) {
  if (typeof input === "string") {
    const input_2 = input;
    return input_2;
  }
  return "fallback";
}`,
  )
})

test("guard descriptors retain concrete union members and support nested guards", () => {
  Program.build(function*() {
    const input = yield* Decl.let("input", Type.union(Type.literal("yes"), Type.number, Type.null, Type.undefined))
    assert.ok(sameType(Guard.typeof(input, "string").type, Type.literal("yes")))
    assert.ok(sameType(Guard.typeof(input, "boolean").type, Type.never))
    assert.ok(sameType(Guard.notNullish(input).type, Type.union(Type.literal("yes"), Type.number)))
    const arrays = yield* Decl.let("arrays", Type.union(Type.array(Type.number), Type.string))
    assert.ok(sameType(Guard.isArray(arrays).type, Type.array(Type.number)))
    yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*(text) {
      yield* Stmt.ifGuard(Guard.notNullish(text), function*(nested) {
        const exact: Equal<Expr.Denotes<typeof nested>, "yes"> = true
        void exact
        yield* Stmt.do(nested)
      })
    })
    return null
  })
})

test("a guarded property is read once, and else branches stay unnarrowed", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ value: Type.unknown }))],
      body: function*({ row }) {
        yield* Stmt.ifGuard(Guard.typeof(Expr.prop(row, "value"), "string"), function*(value) {
          yield* Stmt.return(value)
        }, "text").pipe(
          Stmt.elseIf(false, function*() {
            yield* Stmt.return(false)
          }),
          Stmt.else(function*() {
            expectTypeOf<Expr.Denotes<typeof row>>().toEqualTypeOf<{ value: unknown }>()
            yield* Stmt.return(0)
          }),
        )
        return "unreachable"
      },
    })
  })
  assert.equal(
    emitProgram(program),
    `function read(row: { value: unknown }) {
  const subject = row.value;
  if (typeof subject === "string") {
    const text: string = subject;
    return text;
  } else if (false) {
    return false;
  } else {
    return 0;
  }
  return "unreachable";
}`,
  )
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (row: { value: unknown }) => unknown
  for (const value of ["hello", 42]) {
    let reads = 0
    const result = read({
      get value() {
        reads++
        return value
      },
    })
    assert.equal(result, typeof value === "string" ? value : 0)
    assert.equal(reads, 1)
  }
})

test("notNullish saves calls once before testing and aliasing", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("next", Type.fn([], Type.unknown))],
      body: function*({ next }) {
        yield* Stmt.ifGuard(Guard.notNullish(Expr.call(next)), function*(value) {
          const exact: Equal<Expr.Denotes<typeof value>, {}> = true
          void exact
          yield* Stmt.return(value)
        }, "value")
        return "nullish"
      },
    })
  })
  assert.match(
    emitProgram(program),
    /const subject = next\(\);\n  if \(subject !== null && subject !== undefined\) \{\n    const value: \{\} = subject;/,
  )
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (next: () => unknown) => unknown
  for (const value of [null, undefined, 0, false, "", {}, []]) {
    let calls = 0
    assert.equal(
      read(() => {
        calls++
        return value
      }),
      value === null || value === undefined ? "nullish" : value,
    )
    assert.equal(calls, 1)
  }
})

test("isArray emits an external Array.isArray test and a mutable unknown[] alias", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.isArray(input), function*(items) {
          const exact: Equal<Expr.Denotes<typeof items>, unknown[]> = true
          void exact
          yield* Stmt.return(items)
        }, "items")
        return false
      },
    })
  })
  assert.match(emitProgram(program), /if \(Array.isArray\(input\)\) \{\n    const items: unknown\[\] = input;/)
  assert.match(emitJavaScript(program), /if \(Array.isArray\(input\)\) \{\n    const items = input;/)
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (input: unknown) => unknown
  const array = [1, 2]
  assert.equal(read(array), array)
  assert.equal(read({}), false)
})

test("isArray retains readonly alternatives and initializes mixed aliases without a cast", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("input", Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null))],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.and(Guard.isArray(input), Guard.notNullish(input)), function*(items) {
          const exact: Equal<Expr.Denotes<typeof items>, readonly number[] | string[]> = true
          void exact
          assert.ok(sameType(items.type!, Type.union(Type.readonlyArray(Type.number), Type.array(Type.string))))
          yield* Stmt.return(items)
        }, "items")
        return false
      },
    })
  })
  assert.match(
    emitProgram(program),
    /const items: readonly number\[\] \| string\[\] = \(\(value: readonly number\[\] \| string\[\]\): readonly number\[\] \| string\[\] =>/,
  )
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (input: readonly number[] | string[] | null) => unknown
  const items = [1, 2]
  assert.equal(read(items), items)
  assert.equal(read(null), false)
})

test("typeof function emits Function for unknown and retains callable union members", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.typeof(input, "function"), function*(callable) {
          const exact: Equal<Expr.Denotes<typeof callable>, Guard.Typeof<unknown, "function">> = true
          void exact
          assert.ok(sameType(callable.type!, Type.external("Function")))
          yield* Stmt.return(callable)
        }, "callable")
        return false
      },
    })
  })
  assert.match(emitProgram(program), /if \(typeof input === "function"\) \{\n    const callable: Function = input;/)
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (input: unknown) => unknown
  const callable = () => 42
  assert.equal(read(callable), callable)
  assert.equal(read({}), false)
  Program.build(function*() {
    const fn = Type.fn([Type.string], Type.number)
    const input = yield* Decl.let("input", Type.union(fn, Type.object({ x: Type.number }), Type.null))
    assert.ok(sameType(Guard.typeof(input, "function").type, fn))
    assert.ok(sameType(Guard.typeof(input, "object").type, Type.union(Type.object({ x: Type.number }), Type.null)))
    return null
  })
})

test("instanceOf emits the constructor test and saves a property subject once", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ value: Type.unknown }))],
      body: function*({ row }) {
        yield* Stmt.ifGuard(Guard.instanceOf(Expr.prop(row, "value"), FFI.Value<typeof Date>("Date"), Type.external<Date>("Date")), function*(date) {
          const exact: Equal<Expr.Denotes<typeof date>, Date> = true
          void exact
          yield* Stmt.return(date)
        }, "date")
        return false
      },
    })
  })
  assert.match(emitProgram(program), /const subject = row.value;\n  if \(subject instanceof Date\) \{\n    const date: Date = subject;/)
  assert.match(emitJavaScript(program), /if \(subject instanceof Date\) \{\n    const date = subject;/)
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (row: { value: unknown }) => unknown
  for (const value of [new Date(), {}, null, 42]) {
    let reads = 0
    assert.equal(
      read({
        get value() {
          reads++
          return value
        },
      }),
      value instanceof Date ? value : false,
    )
    assert.equal(reads, 1)
  }
})

test("predicate emits an FFI call and guard clauses expose the witnessed type", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ value: Type.unknown }))],
      body: function*({ row }) {
        return yield* Stmt.guard(
          Guard.predicate(FFI.Value<(value: unknown) => value is string>("isText"), Expr.prop(row, "value"), Type.string),
          function*() {
            yield* Stmt.return(false)
          },
          "text",
        )
      },
    })
  })
  assert.match(
    emitProgram(program),
    /const subject = row.value;\n  if \(!isText\(subject\)\) \{\n    return false;\n  \}\n  const text: string = subject;/,
  )
  const read = new Function("isText", `${emitJavaScript(program)}\nreturn read`)((value: unknown) => typeof value === "string") as (
    row: { value: unknown },
  ) => unknown
  for (const value of ["yes", 42]) {
    let reads = 0
    assert.equal(
      read({
        get value() {
          reads++
          return value
        },
      }),
      typeof value === "string" ? value : false,
    )
    assert.equal(reads, 1)
  }
})

test("phase 3 guard misuse and unsupported constructor overlaps are rejected", () => {
  const unused = function*() {
    const input = yield* Decl.let("input", Type.unknown)
    const ctor = FFI.Value<typeof Date>("Date")
    const date = Type.external<Date>("Date")
    const isDate = FFI.Value<(value: unknown) => value is Date>("isDate")
    // @ts-expect-error instanceOf needs a constructor, not a function
    Guard.instanceOf(input, FFI.Value<() => Date>("factory"), date)
    // @ts-expect-error the witness must equal the constructor's instance type
    Guard.instanceOf(input, ctor, Type.string)
    // @ts-expect-error ordinary boolean functions are not predicates
    Guard.predicate(FFI.Value<(value: unknown) => boolean>("test"), input, date)
    // @ts-expect-error the witness must equal the predicate's asserted type
    Guard.predicate(isDate, input, Type.string)
    // @ts-expect-error the predicate's parameter must accept the subject
    Guard.predicate(FFI.Value<(value: string | number) => value is string>("isText"), input, Type.string)
    const union = yield* Decl.let("union", Type.union(date, Type.string))
    // @ts-expect-error constructor narrowing is not modeled for arbitrary unions
    Guard.instanceOf(union, ctor, date)
    const overlaps = yield* Decl.let("overlaps", Type.union(Type.object({ y: Type.string }), Type.object({ z: Type.number })))
    // @ts-expect-error predicate union overlap without an assignable member is deferred
    Guard.predicate(isDate, overlaps, date)
    // @ts-expect-error a custom prototype changes native instanceof narrowing
    Guard.instanceOf(input, FFI.Value<(abstract new() => Date) & { prototype: { x: number } }>("Odd"), date)
    // @ts-expect-error custom hasInstance predicates change the narrowing target
    Guard.instanceOf(input, FFI.Value<(abstract new() => Date) & { [Symbol.hasInstance]: (value: unknown) => value is string }>("Odd"), date)
    // @ts-expect-error overload resolution could pick a different asserted type
    Guard.predicate(FFI.Value<{ (value: unknown): value is string; (value: unknown): value is number }>("overloaded"), input, Type.number)
    const readonlyItems = yield* Decl.let("readonlyItems", Type.readonlyArray(Type.number))
    // @ts-expect-error index writes through readonly arrays are rejected
    Stmt.assign(Expr.index(readonlyItems, 0), 1)
    const mixedItems = yield* Decl.let("mixedItems", Type.union(Type.readonlyArray(Type.number), Type.array(Type.number)))
    // @ts-expect-error every possible receiver must allow an index write
    Stmt.assign(Expr.index(mixedItems, 0), 1)
  }
  void unused
})

test("a narrowed alias cannot resolve outside its branch or in an else branch", () => {
  for (const inElse of [false, true]) {
    assert.throws(() =>
      Program.build(function*() {
        let escaped: Expr.Ref<string, false> | undefined
        const input = yield* Decl.let("input", Type.unknown)
        const builder = Stmt.ifGuard(Guard.typeof(input, "string"), function*(value) {
          escaped = value
        })
        if (inElse) {
          yield* builder.pipe(Stmt.else(function*() {
            yield* Stmt.do(escaped!)
          }))
        } else {
          yield* builder
          yield* Stmt.do(escaped!)
        }
        return null
      }), /does not resolve to an in-scope binding/)
  }
})

test("guard builders remain lazy and repeated yields use independent bindings", () => {
  let runs = 0
  const ids: Expr.Ref<string, false>["id"][] = []
  const program = Program.build(function*() {
    const input = yield* Decl.let("input", Type.unknown)
    const builder = Stmt.ifGuard(Guard.typeof(input, "string"), function*(value) {
      runs++
      ids.push(value.id)
    })
    assert.equal(runs, 0)
    yield* builder
    yield* builder
    return null
  })
  assert.equal(program.statements.length, 3)
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
})

test("ifGuard preserves early returns, loop statements, and closed builders", () => {
  Program.build(function*() {
    const fn = yield* Decl.fn("read", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.typeof(input, "number"), function*(value) {
          yield* Stmt.return(value)
        }).pipe(Stmt.else(function*() {
          yield* Stmt.return(false)
        }))
        return "done"
      },
    })
    const exact: Equal<ReturnType<Expr.Denotes<typeof fn>>, number | false | "done"> = true
    void exact
    const input = yield* Decl.let("input", Type.unknown)
    yield* Stmt.while(true, function*() {
      yield* Stmt.ifGuard(Guard.notNullish(input), function*() {
        yield* Stmt.break()
        yield* Stmt.continue()
      })
    })
    return null
  })
  const unused = function*() {
    const input = yield* Decl.let("input", Type.unknown)
    const loopOnly = Stmt.ifGuard(Guard.notNullish(input), function*() {
      yield* Stmt.break()
    })
    // @ts-expect-error loop-only statements cannot escape to a program body
    Program.build(function*() {
      yield* loopOnly
    })
    // @ts-expect-error the invariant yielded statement set cannot erase break
    const erased: Stmt.IfBuilder<Stmt.NonLoopStatement> = loopOnly
    void erased
    const closed = Stmt.ifGuard(Guard.notNullish(input), function*() {}).pipe(Stmt.else(function*() {}))
    // @ts-expect-error else closes a guarded builder too
    closed.pipe(Stmt.elseIf(true, function*() {}))
  }
  void unused
})

test("guard misuse is rejected rather than assigning an inaccurate denotation", () => {
  const unused = function*() {
    const input = yield* Decl.let("input", Type.unknown)
    // @ts-expect-error invalid typeof tag
    Guard.typeof(input, "date")
    Guard.typeof(input, "function")
    const tag: "string" | "number" = Math.random() < 0.5 ? "string" : "number"
    // @ts-expect-error a stage-1 union tag would make the emitted annotation branch-dependent
    Guard.typeof(input, tag)
    yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*(value) {
      // @ts-expect-error the alias is const
      Stmt.assign(value, "other")
    })
    // @ts-expect-error structural object members could also be arrays
    Guard.isArray(FFI.Value<number[] | { x: number }>("items"))
    // @ts-expect-error {} includes primitives, so Extract would not model typeof narrowing
    Guard.typeof(FFI.Value<{}>("empty"), "string")
    // @ts-expect-error any is not a concrete subject denotation
    Guard.typeof(FFI.Value<any>("unchecked"), "number")
    const T = Type.param("T")
    const { symbolic } = Expr.paramBindings([Expr.param("symbolic", T)])
    // @ts-expect-error symbolic narrowing is not supported by this phase
    Guard.notNullish(symbolic)
  }
  void unused
  assert.throws(() => Guard.typeof(FFI.Value<unknown>("input"), "string"), /needs subject type metadata/)
})

test("and reapplies refinements, short circuits, and saves a shared subject once", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("next", Type.fn([], Type.unknown))],
      body: function*({ next }) {
        const subject = Expr.call(next)
        const combined = Guard.and(Guard.typeof(subject, "object"), Guard.notNullish(subject))
        assert.ok(sameType(combined.type, Type.object_))
        yield* Stmt.ifGuard(combined, function*(value) {
          const exact: Equal<Expr.Denotes<typeof value>, object> = true
          void exact
          yield* Stmt.return(value)
        }, "value")
        return false
      },
    })
  })
  assert.match(
    emitProgram(program),
    /const subject = next\(\);\n  if \(typeof subject === "object" && \(subject !== null && subject !== undefined\)\) \{\n    const value: object = subject;/,
  )
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (next: () => unknown) => unknown
  for (const value of [null, undefined, 42, "text", {}, []]) {
    let calls = 0
    assert.equal(
      read(() => {
        calls++
        return value
      }),
      typeof value === "object" && value !== null ? value : false,
    )
    assert.equal(calls, 1)
  }
  Program.build(function*() {
    const first = yield* Decl.let("first", Type.unknown)
    const second = yield* Decl.let("second", Type.unknown)
    assert.throws(() => Guard.and(Guard.typeof(first, "object"), Guard.notNullish(second)), /same subject node/)
    return null
  })
})

test("hasOwn preserves the object type while in narrows property presence", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("input", Type.object_)],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.hasOwn(input, "value"), function*(owned) {
          const exact: Equal<Expr.Denotes<typeof owned>, object> = true
          void exact
          yield* Stmt.do(owned)
        }, "owned")
        yield* Stmt.ifGuard(Guard.in(input, "value"), function*(present) {
          const exact: Equal<Expr.Denotes<typeof present>, object & Record<"value", unknown>> = true
          void exact
          yield* Stmt.return(Expr.prop(present, "value"))
        }, "present")
        return false
      },
    })
  })
  assert.match(emitProgram(program), /if \(Object.hasOwn\(input, "value"\)\) \{\n    const owned: object = input;/)
  assert.match(emitProgram(program), /if \("value" in input\) \{\n    const present: object & Record<"value", unknown> = input;/)
  // oxlint-disable-next-line anti-slop/no-object-parameters -- Mirrors the emitted function's object parameter.
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (input: object) => unknown
  assert.equal(read({ value: 42 }), 42)
  assert.equal(read(Object.create({ value: "inherited" }) as object), "inherited")
  assert.equal(read({}), false)
})

test("hasOwn accepts broad and union keys without changing its denotation", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("owns", {
      params: [Expr.param("input", Type.object_)],
      body: function*({ input }) {
        for (const key of ["value", "missing"]) {
          const guard = Guard.hasOwn(input, key)
          assert.ok(sameType(guard.type, Type.object_))
          yield* Stmt.ifGuard(guard, function*(owned) {
            const exact: Equal<Expr.Denotes<typeof owned>, object> = true
            void exact
            yield* Stmt.return(true)
          })
        }
        const unionKey: "value" | "missing" = Math.random() < 0.5 ? "value" : "missing"
        const unionGuard = Guard.hasOwn(input, unionKey)
        assert.ok(sameType(unionGuard.type, Type.object_))
        return false
      },
    })
  })
  assert.match(emitProgram(program), /Object\.hasOwn\(input, "value"\)/)
  assert.match(emitProgram(program), /Object\.hasOwn\(input, "missing"\)/)
  // oxlint-disable-next-line anti-slop/no-object-parameters -- Mirrors the emitted function's object parameter.
  const owns = new Function(`${emitJavaScript(program)}\nreturn owns`)() as (input: object) => boolean
  assert.equal(owns({ value: undefined }), true)
  assert.equal(owns({ missing: 1 }), true)
  assert.equal(owns({}), false)
  assert.equal(owns(Object.create({ value: 1 }) as object), false)
})

test("eq selects discriminated union members and emits a property equality", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param(
        "input",
        Type.union(
          Type.object({ kind: Type.literal("text"), value: Type.string }),
          Type.object({ kind: Type.literal("number"), value: Type.number }),
          Type.object({ kind: Type.literal("empty") }),
        ),
      )],
      body: function*({ input }) {
        yield* Stmt.ifGuard(Guard.eq(input, "kind", "text"), function*(text) {
          const exact: Equal<Expr.Denotes<typeof text>, { kind: "text"; value: string }> = true
          void exact
          yield* Stmt.return(Expr.prop(text, "value"))
        }, "text")
        return false
      },
    })
  })
  assert.match(emitProgram(program), /if \(input.kind === "text"\) \{\n    const text: \{ kind: "text"; value: string \} = input;/)
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (
    input: { kind: "text"; value: string } | { kind: "number"; value: number } | { kind: "empty" },
  ) => unknown
  assert.equal(read({ kind: "text", value: "yes" }), "yes")
  assert.equal(read({ kind: "number", value: 42 }), false)
  assert.equal(read({ kind: "empty" }), false)
})

test("guard clauses expose a const after an exiting failure body and hoist once", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ value: Type.unknown }))],
      body: function*({ row }) {
        const text = yield* Stmt.guard(Guard.typeof(Expr.prop(row, "value"), "string"), function*() {
          yield* Stmt.return(false)
        }, "text")
        const exact: Equal<Expr.Denotes<typeof text>, string> = true
        void exact
        yield* Stmt.do(text)
        return text
      },
    })
  })
  assert.equal(
    emitProgram(program),
    `function read(row: { value: unknown }) {
  const subject = row.value;
  if (!(typeof subject === "string")) {
    return false;
  }
  const text: string = subject;
  text;
  return text;
}`,
  )
  assert.equal(
    emitJavaScript(program),
    `function read(row) {
  const subject = row.value;
  if (!(typeof subject === "string")) {
    return false;
  }
  const text = subject;
  text;
  return text;
}`,
  )
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (row: { value: unknown }) => unknown
  for (const value of ["hello", 42]) {
    let reads = 0
    assert.equal(
      read({
        get value() {
          reads++
          return value
        },
      }),
      typeof value === "string" ? value : false,
    )
    assert.equal(reads, 1)
  }
  for (
    const failure of [function*() {}, function*() {
      yield* Stmt.do(false)
    }]
  ) {
    assert.throws(() =>
      Program.build(function*() {
        const input = yield* Decl.let("input", Type.unknown)
        yield* Stmt.guard(Guard.notNullish(input), failure)
        return null
      }), /failure body must end with return, throw, break, or continue/)
  }
})

test("guard clause yields preserve returns, loop restrictions, and laziness", () => {
  let runs = 0
  const ids: Expr.Ref<string, false>["id"][] = []
  Program.build(function*() {
    const fn = yield* Decl.fn("read", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        const builder = Stmt.guard(Guard.typeof(input, "string"), function*() {
          runs++
          yield* Stmt.return(false)
        })
        assert.equal(runs, 0)
        const first = yield* builder
        const second = yield* builder
        ids.push(first.id, second.id)
        return first
      },
    })
    const exact: Equal<ReturnType<Expr.Denotes<typeof fn>>, string | false> = true
    void exact
    const input = yield* Decl.let("input", Type.unknown)
    yield* Stmt.while(true, function*() {
      const value = yield* Stmt.guard(Guard.notNullish(input), function*() {
        yield* Stmt.continue()
      })
      yield* Stmt.do(value)
      yield* Stmt.guard(Guard.notNullish(input), function*() {
        yield* Stmt.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  const unused = function*() {
    const input = yield* Decl.let("input", Type.unknown)
    for (const exit of [Stmt.break, Stmt.continue]) {
      const builder = Stmt.guard(Guard.notNullish(input), function*() {
        yield* exit()
      })
      // @ts-expect-error loop-only guard failures cannot escape to a program body
      Program.build(function*() {
        yield* builder
      })
      Decl.fn("invalid", {
        // @ts-expect-error loop-only guard failures cannot escape to a function body
        body: function*() {
          yield* builder
          return false
        },
      })
      // @ts-expect-error invariant yields cannot erase the loop-only statements
      const erased: Stmt.GuardBuilder<{}, Stmt.NonLoopStatement> = builder
      void erased
    }
  }
  void unused
})

test("phase 2 guard misuse is rejected at type level", () => {
  const unused = function*() {
    const input = yield* Decl.let("input", Type.unknown)
    // @ts-expect-error hasOwn requires an already-object subject
    Guard.hasOwn(input, "x")
    // @ts-expect-error in requires an already-object subject
    Guard.in(input, "x")
    const one = yield* Decl.let("one", Type.object({ kind: Type.literal("a") }))
    // @ts-expect-error a single object is not a discriminated union
    Guard.eq(one, "kind", "a")
    const broad = yield* Decl.let(
      "broad",
      Type.union(Type.object({ kind: Type.string, x: Type.number }), Type.object({ kind: Type.string, y: Type.number })),
    )
    // @ts-expect-error broad strings are not literal discriminants
    Guard.eq(broad, "kind", "a")
    const optional = yield* Decl.let(
      "optional",
      Type.union(Type.object({ kind: Type.optional(Type.literal("a")) }), Type.object({ kind: Type.literal("b") })),
    )
    // @ts-expect-error discriminants must be required on every member
    Guard.eq(optional, "kind", "a")
    const union = yield* Decl.let("union", Type.union(Type.object({ kind: Type.literal("a") }), Type.object({ kind: Type.literal("b") })))
    // @ts-expect-error the key must be a discriminant shared by every member
    Guard.eq(union, "missing", "a")
    // @ts-expect-error the value must match a discriminant
    Guard.eq(union, "kind", "c")
    const literal: "a" | "b" = Math.random() < 0.5 ? "a" : "b"
    // @ts-expect-error stage-1 union values do not describe one emitted narrowing
    Guard.eq(union, "kind", literal)
    // @ts-expect-error the right equality would produce TS2367 after the left one narrows to "a"
    Guard.and(Guard.eq(union, "kind", "a"), Guard.eq(union, "kind", "b"))
    const mixed = yield* Decl.let(
      "mixed",
      Type.union(Type.object({ kind: Type.union(Type.literal("a"), Type.literal("b")) }), Type.object({ kind: Type.literal("c") })),
    )
    // @ts-expect-error each member must have one literal discriminant, not a union
    Guard.eq(mixed, "kind", "a")
    const templated = yield* Decl.let(
      "templated",
      Type.union(
        Type.object({ kind: Type.template(["field", ""], Type.number) }),
        Type.object({ kind: Type.literal("other") }),
      ),
    )
    // @ts-expect-error an infinite template pattern is not a literal discriminant
    Guard.eq(templated, "kind", "field1")
    const key: "x" | "y" = Math.random() < 0.5 ? "x" : "y"
    // @ts-expect-error in needs one literal key
    Guard.in(one, key)
    const pattern: `field${number}` = `field${Math.random()}`
    // @ts-expect-error an infinite template pattern is not one literal key
    Guard.in(one, pattern)
    // @ts-expect-error refinement cannot model Array.isArray(object) as Extract<object, unknown[]>
    Guard.and(Guard.typeof(input, "object"), Guard.isArray(input))
    yield* Stmt.guard(Guard.typeof(input, "string"), function*() {
      yield* Stmt.throw("not text")
    })
    const text = yield* Stmt.guard(Guard.typeof(input, "string"), function*() {
      yield* Stmt.throw("not text")
    })
    // @ts-expect-error the guard-clause alias is const
    Stmt.assign(text, "other")
  }
  void unused
})

test("elseGuard emits a fresh complement alias and saves property subjects once", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ value: Type.union(Type.string, Type.number, Type.null) }))],
      body: function*({ row }) {
        yield* Stmt.ifGuard(Guard.typeof(Expr.prop(row, "value"), "string"), function*(text) {
          yield* Stmt.return(text)
        }, "text").elseGuard(function*(rest) {
          const exact: Equal<Expr.Denotes<typeof rest>, number | null> = true
          void exact
          assert.equal(rest.mutable, false)
          yield* Stmt.return(rest)
        })
        return false
      },
    })
  })
  assert.equal(
    emitProgram(program),
    `function read(row: { value: string | number | null }) {
  const subject = row.value;
  if (typeof subject === "string") {
    const text: string = subject;
    return text;
  } else {
    const rest: number | null = ((value: number | null): number | null => {
      return value;
    })(subject);
    return rest;
  }
  return false;
}`,
  )
  assert.match(emitJavaScript(program), /const rest = \(\(value\) =>/)
  const read = new Function(`${emitJavaScript(program)}\nreturn read`)() as (row: { value: string | number | null }) => unknown
  for (const value of ["yes", 42, null]) {
    let reads = 0
    assert.equal(
      read({
        get value() {
          reads++
          return value
        },
      }),
      value,
    )
    assert.equal(reads, 1)
  }
})

test("elseGuard complements reflect native readonly, optional, and unknown narrowing", () => {
  Program.build(function*() {
    const arrays = yield* Decl.let("arrays", Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null))
    yield* Stmt.ifGuard(Guard.isArray(arrays), function*() {}).elseGuard(function*(rest) {
      const exact: Equal<Expr.Denotes<typeof rest>, readonly number[] | null> = true
      void exact
      yield* Stmt.do(rest)
    }, "notMutable")
    const input = yield* Decl.let("input", Type.unknown)
    yield* Stmt.ifGuard(Guard.notNullish(input), function*() {}).elseGuard(function*(rest) {
      const exact: Equal<Expr.Denotes<typeof rest>, null | undefined> = true
      void exact
      yield* Stmt.do(rest)
    })
    yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      const exact: Equal<Expr.Denotes<typeof rest>, unknown> = true
      void exact
      yield* Stmt.do(rest)
    })
    const optional = yield* Decl.let("optional", Type.union(Type.object({ a: Type.optional(Type.number) }), Type.object({ b: Type.string })))
    yield* Stmt.ifGuard(Guard.in(optional, "a"), function*() {}).elseGuard(function*(rest) {
      const exact: Equal<Expr.Denotes<typeof rest>, { a?: number } | { b: string }> = true
      void exact
      yield* Stmt.do(rest)
    })
    return null
  })
})

test("elseGuard remains lazy, preserves returns and loop yields, and scopes aliases", () => {
  let runs = 0
  const ids: Expr.Ref<number, false>["id"][] = []
  Program.build(function*() {
    const input = yield* Decl.let("input", Type.union(Type.string, Type.number))
    const builder = Stmt.ifGuard(Guard.typeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      runs++
      ids.push(rest.id)
    })
    assert.equal(runs, 0)
    yield* builder
    yield* builder
    const fn = yield* Decl.fn("read", {
      params: [Expr.param("value", Type.union(Type.string, Type.number))],
      body: function*({ value }) {
        yield* Stmt.ifGuard(Guard.typeof(value, "string"), function*(text) {
          yield* Stmt.return(text)
        }).elseGuard(function*(rest) {
          yield* Stmt.return(rest)
        })
        return false
      },
    })
    const exact: Equal<ReturnType<Expr.Denotes<typeof fn>>, string | number | false> = true
    void exact
    yield* Stmt.while(true, function*() {
      yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*() {}).elseGuard(function*() {
        yield* Stmt.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  assert.throws(() =>
    Program.build(function*() {
      let escaped: Expr.Ref<number, false> | undefined
      const input = yield* Decl.let("input", Type.union(Type.string, Type.number))
      yield* Stmt.ifGuard(Guard.typeof(input, "string"), function*() {}).elseGuard(function*(rest) {
        escaped = rest
      })
      yield* Stmt.do(escaped!)
      return null
    }), /does not resolve to an in-scope binding/)
})

test("unsupported complements and elseGuard misuse are rejected", () => {
  const unused = function*() {
    const input = yield* Decl.let("input", Type.union(Type.string, Type.number))
    const builder = Stmt.ifGuard(Guard.typeof(input, "string"), function*() {})
    builder.elseGuard(function*(rest) {
      // @ts-expect-error negative aliases are const too
      Stmt.assign(rest, 1)
    })
    // @ts-expect-error non-guard if builders have no complement
    Stmt.if(true, function*() {}).elseGuard(function*() {})
    const closed = builder.elseGuard(function*() {})
    // @ts-expect-error elseGuard closes the builder
    closed.elseGuard(function*() {})
    // @ts-expect-error double else is rejected
    closed.pipe(Stmt.else(function*() {}))
    // @ts-expect-error double else in the opposite order is rejected
    builder.pipe(Stmt.else(function*() {})).elseGuard(function*() {})
    // @ts-expect-error later elseIf tests are intentionally not modeled
    builder.pipe(Stmt.elseIf(true, function*() {})).elseGuard(function*() {})
    const loop = builder.elseGuard(function*() {
      yield* Stmt.continue()
    })
    // @ts-expect-error loop-only negative branches cannot escape their loop
    Program.build(function*() {
      yield* loop
    })
    const row = Type.object({ x: Type.number })
    const overlap = yield* Decl.let("overlap", Type.object({ y: Type.string }))
    const predicate = FFI.Value<(value: unknown) => value is { x: number }>("isRow")
    // @ts-expect-error partially overlapping predicate complements are not proven exact
    Stmt.ifGuard(Guard.predicate(predicate, overlap, row), function*() {}).elseGuard(function*() {})
    const subtype = yield* Decl.let("subtype", Type.union(Type.object({ x: Type.number, extra: Type.boolean }), Type.string))
    // @ts-expect-error subtype predicates need a separate negative-narrowing proof
    Stmt.ifGuard(Guard.predicate(predicate, subtype, row), function*() {}).elseGuard(function*() {})
    // @ts-expect-error an and propagates unsupported negative refinements
    Stmt.ifGuard(Guard.and(Guard.predicate(predicate, overlap, row), Guard.notNullish(overlap)), function*() {}).elseGuard(function*() {})
    const opaque: Guard.Guard<string> = Guard.typeof(input, "string")
    // @ts-expect-error erasing a guard's refinement also erases its complement proof
    Stmt.ifGuard(opaque, function*() {}).elseGuard(function*() {})
    const unknown = yield* Decl.let("unknown", Type.unknown)
    // @ts-expect-error unknown asserted types have a special native false branch
    Stmt.ifGuard(Guard.predicate(FFI.Value<(value: unknown) => value is unknown>("isUnknown"), unknown, Type.unknown), function*() {}).elseGuard(
      function*() {},
    )
    // @ts-expect-error {} asserted types have a special native false branch
    Stmt.ifGuard(Guard.predicate(FFI.Value<(value: unknown) => value is {}>("isEmpty"), unknown, Type.object({})), function*() {}).elseGuard(
      function*() {},
    )
    const nullish = Guard.predicate(
      FFI.Value<(value: unknown) => value is null | undefined>("isNullish"),
      unknown,
      Type.union(Type.null, Type.undefined),
    )
    // @ts-expect-error nullish asserted types have a special native false branch
    Stmt.ifGuard(nullish, function*() {}).elseGuard(function*() {})
    const indexSignature = yield* Decl.let("indexSignature", Type.object({} as Record<string, typeof Type.number>))
    // @ts-expect-error native in narrowing does not remove index-signature members
    Stmt.ifGuard(Guard.in(indexSignature, "x"), function*() {}).elseGuard(function*() {})
    const object = yield* Decl.let("object", Type.object_)
    // @ts-expect-error tsc reduces partially overlapping false-flow unions, unlike a declared union
    Stmt.ifGuard(Guard.and(Guard.in(object, "first"), Guard.in(object, "second")), function*() {}).elseGuard(function*() {})
    const rows = yield* Decl.let("rows", Type.union(Type.object({ a: Type.optional(Type.number) }), Type.object({ b: Type.string })))
    // @ts-expect-error an unlisted-property intersection overlaps the first false branch
    Stmt.ifGuard(Guard.and(Guard.in(rows, "missing"), Guard.in(rows, "a")), function*() {}).elseGuard(function*() {})
    const tagged = yield* Decl.let("tagged", Type.union(Type.object({ kind: Type.literal("a") }), Type.object({ kind: Type.literal("b") })))
    // @ts-expect-error a later discriminant also creates partially overlapping false branches
    Stmt.ifGuard(Guard.and(Guard.in(tagged, "value"), Guard.eq(tagged, "kind", "a")), function*() {}).elseGuard(function*() {})
  }
  void unused
})
