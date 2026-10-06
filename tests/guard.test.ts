import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("ifGuard introduces a fresh annotated const without retyping the subject", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        yield* T.ifGuard(T.isTypeof(input, "string"), function*(narrowed) {
          assertType<Equal<T.Denotes<typeof narrowed>, string>>()
          expectTypeOf<T.Denotes<typeof input>>().toEqualTypeOf<unknown>()
          assert.notEqual(input.id, narrowed.id)
          assert.equal(narrowed.mutable, false)
          yield* T.return(narrowed)
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
  T.build(function*() {
    const input = yield* T.let("input", T.Union(T.Literal("yes"), T.Number, T.Null, T.Undefined))
    assert.ok(sameType(T.isTypeof(input, "string").type, T.Literal("yes")))
    assert.ok(sameType(T.isTypeof(input, "boolean").type, T.Never))
    assert.ok(sameType(T.notNullish(input).type, T.Union(T.Literal("yes"), T.Number)))
    const arrays = yield* T.let("arrays", T.Union(T.Array(T.Number), T.String))
    assert.ok(sameType(T.isArray(arrays).type, T.Array(T.Number)))
    yield* T.ifGuard(T.isTypeof(input, "string"), function*(text) {
      yield* T.ifGuard(T.notNullish(text), function*(nested) {
        assertType<Equal<T.Denotes<typeof nested>, "yes">>()
        yield* T.do(nested)
      })
    })
    return null
  })
})

test("a guarded property is read once, and else branches stay unnarrowed", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ value: T.Unknown }))],
      body: function*({ row }) {
        yield* T.ifGuard(T.isTypeof(T.prop(row, "value"), "string"), function*(value) {
          yield* T.return(value)
        }, "text").pipe(
          T.elseIf(false, function*() {
            yield* T.return(false)
          }),
          T.else(function*() {
            expectTypeOf<T.Denotes<typeof row>>().toEqualTypeOf<{ value: unknown }>()
            yield* T.return(0)
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("next", T.Function([], T.Unknown))],
      body: function*({ next }) {
        yield* T.ifGuard(T.notNullish(T.call(next)), function*(value) {
          assertType<Equal<T.Denotes<typeof value>, {}>>()
          yield* T.return(value)
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        yield* T.ifGuard(T.isArray(input), function*(items) {
          assertType<Equal<T.Denotes<typeof items>, unknown[]>>()
          yield* T.return(items)
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("input", T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null))],
      body: function*({ input }) {
        yield* T.ifGuard(T.allOf(T.isArray(input), T.notNullish(input)), function*(items) {
          assertType<Equal<T.Denotes<typeof items>, readonly number[] | string[]>>()
          assert.ok(sameType(items.type!, T.Union(T.ReadonlyArray(T.Number), T.Array(T.String))))
          yield* T.return(items)
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        yield* T.ifGuard(T.isTypeof(input, "function"), function*(callable) {
          assertType<Equal<T.Denotes<typeof callable>, T.Typeof<unknown, "function">>>()
          assert.ok(sameType(callable.type!, T.External("Function")))
          yield* T.return(callable)
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
  T.build(function*() {
    const fn = T.Function([T.String], T.Number)
    const input = yield* T.let("input", T.Union(fn, T.Object({ x: T.Number }), T.Null))
    assert.ok(sameType(T.isTypeof(input, "function").type, fn))
    assert.ok(sameType(T.isTypeof(input, "object").type, T.Union(T.Object({ x: T.Number }), T.Null)))
    return null
  })
})

test("instanceOf emits the constructor test and saves a property subject once", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ value: T.Unknown }))],
      body: function*({ row }) {
        yield* T.ifGuard(T.instanceOf(T.prop(row, "value"), T.hostValue<typeof Date>("Date"), T.External<Date>("Date")), function*(date) {
          assertType<Equal<T.Denotes<typeof date>, Date>>()
          yield* T.return(date)
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ value: T.Unknown }))],
      body: function*({ row }) {
        return yield* T.guard(
          T.predicate(T.hostValue<(value: unknown) => value is string>("isText"), T.prop(row, "value"), T.String),
          function*() {
            yield* T.return(false)
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
    const input = yield* T.let("input", T.Unknown)
    const ctor = T.hostValue<typeof Date>("Date")
    const date = T.External<Date>("Date")
    const isDate = T.hostValue<(value: unknown) => value is Date>("isDate")
    // @ts-expect-error instanceOf needs a constructor, not a function
    T.instanceOf(input, T.hostValue<() => Date>("factory"), date)
    // @ts-expect-error the witness must equal the constructor's instance type
    T.instanceOf(input, ctor, T.String)
    // @ts-expect-error ordinary boolean functions are not predicates
    T.predicate(T.hostValue<(value: unknown) => boolean>("test"), input, date)
    // @ts-expect-error the witness must equal the predicate's asserted type
    T.predicate(isDate, input, T.String)
    // @ts-expect-error the predicate's parameter must accept the subject
    T.predicate(T.hostValue<(value: string | number) => value is string>("isText"), input, T.String)
    const union = yield* T.let("union", T.Union(date, T.String))
    // @ts-expect-error constructor narrowing is not modeled for arbitrary unions
    T.instanceOf(union, ctor, date)
    const overlaps = yield* T.let("overlaps", T.Union(T.Object({ y: T.String }), T.Object({ z: T.Number })))
    // @ts-expect-error predicate union overlap without an assignable member is deferred
    T.predicate(isDate, overlaps, date)
    // @ts-expect-error a custom prototype changes native instanceof narrowing
    T.instanceOf(input, T.hostValue<(abstract new() => Date) & { prototype: { x: number } }>("Odd"), date)
    // @ts-expect-error custom hasInstance predicates change the narrowing target
    T.instanceOf(input, T.hostValue<(abstract new() => Date) & { [Symbol.hasInstance]: (value: unknown) => value is string }>("Odd"), date)
    // @ts-expect-error overload resolution could pick a different asserted type
    T.predicate(T.hostValue<{ (value: unknown): value is string; (value: unknown): value is number }>("overloaded"), input, T.Number)
    const readonlyItems = yield* T.let("readonlyItems", T.ReadonlyArray(T.Number))
    // @ts-expect-error index writes through readonly arrays are rejected
    T.assign(T.index(readonlyItems, 0), 1)
    const mixedItems = yield* T.let("mixedItems", T.Union(T.ReadonlyArray(T.Number), T.Array(T.Number)))
    // @ts-expect-error every possible receiver must allow an index write
    T.assign(T.index(mixedItems, 0), 1)
  }
  void unused
})

test("a narrowed alias cannot resolve outside its branch or in an else branch", () => {
  for (const inElse of [false, true]) {
    assert.throws(() =>
      T.build(function*() {
        let escaped: T.Ref<string, false> | undefined
        const input = yield* T.let("input", T.Unknown)
        const builder = T.ifGuard(T.isTypeof(input, "string"), function*(value) {
          escaped = value
        })
        if (inElse) {
          yield* builder.pipe(T.else(function*() {
            yield* T.do(escaped!)
          }))
        } else {
          yield* builder
          yield* T.do(escaped!)
        }
        return null
      }), /does not resolve to an in-scope binding/)
  }
})

test("guard builders remain lazy and repeated yields use independent bindings", () => {
  let runs = 0
  const ids: T.Ref<string, false>["id"][] = []
  const program = T.build(function*() {
    const input = yield* T.let("input", T.Unknown)
    const builder = T.ifGuard(T.isTypeof(input, "string"), function*(value) {
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
  T.build(function*() {
    const fn = yield* T.fn("read", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        yield* T.ifGuard(T.isTypeof(input, "number"), function*(value) {
          yield* T.return(value)
        }).pipe(T.else(function*() {
          yield* T.return(false)
        }))
        return "done"
      },
    })
    assertType<Equal<ReturnType<T.Denotes<typeof fn>>, number | false | "done">>()
    const input = yield* T.let("input", T.Unknown)
    yield* T.while(true, function*() {
      yield* T.ifGuard(T.notNullish(input), function*() {
        yield* T.break()
        yield* T.continue()
      })
    })
    return null
  })
  const unused = function*() {
    const input = yield* T.let("input", T.Unknown)
    const loopOnly = T.ifGuard(T.notNullish(input), function*() {
      yield* T.break()
    })
    // @ts-expect-error loop-only statements cannot escape to a program body
    T.build(function*() {
      yield* loopOnly
    })
    // @ts-expect-error the invariant yielded statement set cannot erase break
    const erased: T.IfBuilder<T.NonLoopStatement> = loopOnly
    void erased
    const closed = T.ifGuard(T.notNullish(input), function*() {}).pipe(T.else(function*() {}))
    // @ts-expect-error else closes a guarded builder too
    closed.pipe(T.elseIf(true, function*() {}))
  }
  void unused
})

test("guard misuse is rejected rather than assigning an inaccurate denotation", () => {
  const unused = function*() {
    const input = yield* T.let("input", T.Unknown)
    // @ts-expect-error invalid typeof tag
    T.isTypeof(input, "date")
    T.isTypeof(input, "function")
    const tag: "string" | "number" = Math.random() < 0.5 ? "string" : "number"
    // @ts-expect-error a stage-1 union tag would make the emitted annotation branch-dependent
    T.isTypeof(input, tag)
    yield* T.ifGuard(T.isTypeof(input, "string"), function*(value) {
      // @ts-expect-error the alias is const
      T.assign(value, "other")
    })
    // @ts-expect-error structural object members could also be arrays
    T.isArray(T.hostValue<number[] | { x: number }>("items"))
    // @ts-expect-error {} includes primitives, so Extract would not model typeof narrowing
    T.isTypeof(T.hostValue<{}>("empty"), "string")
    // @ts-expect-error any is not a concrete subject denotation
    T.isTypeof(T.hostValue<any>("unchecked"), "number")
    const TParam = T.TypeParam("T")
    const { symbolic } = T.paramBindings([T.param("symbolic", TParam)])
    // @ts-expect-error symbolic narrowing is not supported by this phase
    T.notNullish(symbolic)
  }
  void unused
  assert.throws(() => T.isTypeof(T.hostValue<unknown>("input"), "string"), /needs subject type metadata/)
})

test("and reapplies refinements, short circuits, and saves a shared subject once", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("next", T.Function([], T.Unknown))],
      body: function*({ next }) {
        const subject = T.call(next)
        const combined = T.allOf(T.isTypeof(subject, "object"), T.notNullish(subject))
        assert.ok(sameType(combined.type, T.NonPrimitive))
        yield* T.ifGuard(combined, function*(value) {
          assertType<Equal<T.Denotes<typeof value>, object>>()
          yield* T.return(value)
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
  T.build(function*() {
    const first = yield* T.let("first", T.Unknown)
    const second = yield* T.let("second", T.Unknown)
    assert.throws(() => T.allOf(T.isTypeof(first, "object"), T.notNullish(second)), /same subject node/)
    return null
  })
})

test("hasOwn preserves the object type while in narrows property presence", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("input", T.NonPrimitive)],
      body: function*({ input }) {
        yield* T.ifGuard(T.hasOwn(input, "value"), function*(owned) {
          assertType<Equal<T.Denotes<typeof owned>, object>>()
          yield* T.do(owned)
        }, "owned")
        yield* T.ifGuard(T.in(input, "value"), function*(present) {
          assertType<Equal<T.Denotes<typeof present>, object & Record<"value", unknown>>>()
          yield* T.return(T.prop(present, "value"))
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
  const program = T.build(function*() {
    return yield* T.fn("owns", {
      params: [T.param("input", T.NonPrimitive)],
      body: function*({ input }) {
        for (const key of ["value", "missing"]) {
          const guard = T.hasOwn(input, key)
          assert.ok(sameType(guard.type, T.NonPrimitive))
          yield* T.ifGuard(guard, function*(owned) {
            assertType<Equal<T.Denotes<typeof owned>, object>>()
            yield* T.return(true)
          })
        }
        const unionKey: "value" | "missing" = Math.random() < 0.5 ? "value" : "missing"
        const unionGuard = T.hasOwn(input, unionKey)
        assert.ok(sameType(unionGuard.type, T.NonPrimitive))
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param(
        "input",
        T.Union(
          T.Object({ kind: T.Literal("text"), value: T.String }),
          T.Object({ kind: T.Literal("number"), value: T.Number }),
          T.Object({ kind: T.Literal("empty") }),
        ),
      )],
      body: function*({ input }) {
        yield* T.ifGuard(T.isEq(input, "kind", "text"), function*(text) {
          assertType<Equal<T.Denotes<typeof text>, { kind: "text"; value: string }>>()
          yield* T.return(T.prop(text, "value"))
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
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ value: T.Unknown }))],
      body: function*({ row }) {
        const text = yield* T.guard(T.isTypeof(T.prop(row, "value"), "string"), function*() {
          yield* T.return(false)
        }, "text")
        assertType<Equal<T.Denotes<typeof text>, string>>()
        yield* T.do(text)
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
      yield* T.do(false)
    }]
  ) {
    assert.throws(() =>
      T.build(function*() {
        const input = yield* T.let("input", T.Unknown)
        yield* T.guard(T.notNullish(input), failure)
        return null
      }), /failure body must end with return, throw, break, or continue/)
  }
})

test("guard clause yields preserve returns, loop restrictions, and laziness", () => {
  let runs = 0
  const ids: T.Ref<string, false>["id"][] = []
  T.build(function*() {
    const fn = yield* T.fn("read", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        const builder = T.guard(T.isTypeof(input, "string"), function*() {
          runs++
          yield* T.return(false)
        })
        assert.equal(runs, 0)
        const first = yield* builder
        const second = yield* builder
        ids.push(first.id, second.id)
        return first
      },
    })
    assertType<Equal<ReturnType<T.Denotes<typeof fn>>, string | false>>()
    const input = yield* T.let("input", T.Unknown)
    yield* T.while(true, function*() {
      const value = yield* T.guard(T.notNullish(input), function*() {
        yield* T.continue()
      })
      yield* T.do(value)
      yield* T.guard(T.notNullish(input), function*() {
        yield* T.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  const unused = function*() {
    const input = yield* T.let("input", T.Unknown)
    for (const exit of [T.break, T.continue]) {
      const builder = T.guard(T.notNullish(input), function*() {
        yield* exit()
      })
      // @ts-expect-error loop-only guard failures cannot escape to a program body
      T.build(function*() {
        yield* builder
      })
      T.fn("invalid", {
        // @ts-expect-error loop-only guard failures cannot escape to a function body
        body: function*() {
          yield* builder
          return false
        },
      })
      // @ts-expect-error invariant yields cannot erase the loop-only statements
      const erased: T.GuardBuilder<{}, T.NonLoopStatement> = builder
      void erased
    }
  }
  void unused
})

test("phase 2 guard misuse is rejected at type level", () => {
  const unused = function*() {
    const input = yield* T.let("input", T.Unknown)
    // @ts-expect-error hasOwn requires an already-object subject
    T.hasOwn(input, "x")
    // @ts-expect-error in requires an already-object subject
    T.in(input, "x")
    const one = yield* T.let("one", T.Object({ kind: T.Literal("a") }))
    // @ts-expect-error a single object is not a discriminated union
    T.isEq(one, "kind", "a")
    const broad = yield* T.let(
      "broad",
      T.Union(T.Object({ kind: T.String, x: T.Number }), T.Object({ kind: T.String, y: T.Number })),
    )
    // @ts-expect-error broad strings are not literal discriminants
    T.isEq(broad, "kind", "a")
    const optional = yield* T.let(
      "optional",
      T.Union(T.Object({ kind: T.Optional(T.Literal("a")) }), T.Object({ kind: T.Literal("b") })),
    )
    // @ts-expect-error discriminants must be required on every member
    T.isEq(optional, "kind", "a")
    const union = yield* T.let("union", T.Union(T.Object({ kind: T.Literal("a") }), T.Object({ kind: T.Literal("b") })))
    // @ts-expect-error the key must be a discriminant shared by every member
    T.isEq(union, "missing", "a")
    // @ts-expect-error the value must match a discriminant
    T.isEq(union, "kind", "c")
    const literal: "a" | "b" = Math.random() < 0.5 ? "a" : "b"
    // @ts-expect-error stage-1 union values do not describe one emitted narrowing
    T.isEq(union, "kind", literal)
    // @ts-expect-error the right equality would produce TS2367 after the left one narrows to "a"
    T.allOf(T.isEq(union, "kind", "a"), T.isEq(union, "kind", "b"))
    const mixed = yield* T.let(
      "mixed",
      T.Union(T.Object({ kind: T.Union(T.Literal("a"), T.Literal("b")) }), T.Object({ kind: T.Literal("c") })),
    )
    // @ts-expect-error each member must have one literal discriminant, not a union
    T.isEq(mixed, "kind", "a")
    const templated = yield* T.let(
      "templated",
      T.Union(
        T.Object({ kind: T.Template(["field", ""], T.Number) }),
        T.Object({ kind: T.Literal("other") }),
      ),
    )
    // @ts-expect-error an infinite template pattern is not a literal discriminant
    T.isEq(templated, "kind", "field1")
    const key: "x" | "y" = Math.random() < 0.5 ? "x" : "y"
    // @ts-expect-error in needs one literal key
    T.in(one, key)
    const pattern: `field${number}` = `field${Math.random()}`
    // @ts-expect-error an infinite template pattern is not one literal key
    T.in(one, pattern)
    // @ts-expect-error refinement cannot model Array.isArray(object) as Extract<object, unknown[]>
    T.allOf(T.isTypeof(input, "object"), T.isArray(input))
    yield* T.guard(T.isTypeof(input, "string"), function*() {
      yield* T.throw("not text")
    })
    const text = yield* T.guard(T.isTypeof(input, "string"), function*() {
      yield* T.throw("not text")
    })
    // @ts-expect-error the guard-clause alias is const
    T.assign(text, "other")
  }
  void unused
})

test("elseGuard emits a fresh complement alias and saves property subjects once", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ value: T.Union(T.String, T.Number, T.Null) }))],
      body: function*({ row }) {
        yield* T.ifGuard(T.isTypeof(T.prop(row, "value"), "string"), function*(text) {
          yield* T.return(text)
        }, "text").elseGuard(function*(rest) {
          assertType<Equal<T.Denotes<typeof rest>, number | null>>()
          assert.equal(rest.mutable, false)
          yield* T.return(rest)
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
  T.build(function*() {
    const arrays = yield* T.let("arrays", T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null))
    yield* T.ifGuard(T.isArray(arrays), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<T.Denotes<typeof rest>, readonly number[] | null>>()
      yield* T.do(rest)
    }, "notMutable")
    const input = yield* T.let("input", T.Unknown)
    yield* T.ifGuard(T.notNullish(input), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<T.Denotes<typeof rest>, null | undefined>>()
      yield* T.do(rest)
    })
    yield* T.ifGuard(T.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<T.Denotes<typeof rest>, unknown>>()
      yield* T.do(rest)
    })
    const optional = yield* T.let("optional", T.Union(T.Object({ a: T.Optional(T.Number) }), T.Object({ b: T.String })))
    yield* T.ifGuard(T.in(optional, "a"), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<T.Denotes<typeof rest>, { a?: number } | { b: string }>>()
      yield* T.do(rest)
    })
    return null
  })
})

test("elseGuard remains lazy, preserves returns and loop yields, and scopes aliases", () => {
  let runs = 0
  const ids: T.Ref<number, false>["id"][] = []
  T.build(function*() {
    const input = yield* T.let("input", T.Union(T.String, T.Number))
    const builder = T.ifGuard(T.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      runs++
      ids.push(rest.id)
    })
    assert.equal(runs, 0)
    yield* builder
    yield* builder
    const fn = yield* T.fn("read", {
      params: [T.param("value", T.Union(T.String, T.Number))],
      body: function*({ value }) {
        yield* T.ifGuard(T.isTypeof(value, "string"), function*(text) {
          yield* T.return(text)
        }).elseGuard(function*(rest) {
          yield* T.return(rest)
        })
        return false
      },
    })
    assertType<Equal<ReturnType<T.Denotes<typeof fn>>, string | number | false>>()
    yield* T.while(true, function*() {
      yield* T.ifGuard(T.isTypeof(input, "string"), function*() {}).elseGuard(function*() {
        yield* T.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  assert.throws(() =>
    T.build(function*() {
      let escaped: T.Ref<number, false> | undefined
      const input = yield* T.let("input", T.Union(T.String, T.Number))
      yield* T.ifGuard(T.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
        escaped = rest
      })
      yield* T.do(escaped!)
      return null
    }), /does not resolve to an in-scope binding/)
})

test("unsupported complements and elseGuard misuse are rejected", () => {
  const unused = function*() {
    const input = yield* T.let("input", T.Union(T.String, T.Number))
    const builder = T.ifGuard(T.isTypeof(input, "string"), function*() {})
    builder.elseGuard(function*(rest) {
      // @ts-expect-error negative aliases are const too
      T.assign(rest, 1)
    })
    // @ts-expect-error non-guard if builders have no complement
    T.if(true, function*() {}).elseGuard(function*() {})
    const closed = builder.elseGuard(function*() {})
    // @ts-expect-error elseGuard closes the builder
    closed.elseGuard(function*() {})
    // @ts-expect-error double else is rejected
    closed.pipe(T.else(function*() {}))
    // @ts-expect-error double else in the opposite order is rejected
    builder.pipe(T.else(function*() {})).elseGuard(function*() {})
    // @ts-expect-error later elseIf tests are intentionally not modeled
    builder.pipe(T.elseIf(true, function*() {})).elseGuard(function*() {})
    const loop = builder.elseGuard(function*() {
      yield* T.continue()
    })
    // @ts-expect-error loop-only negative branches cannot escape their loop
    T.build(function*() {
      yield* loop
    })
    const row = T.Object({ x: T.Number })
    const overlap = yield* T.let("overlap", T.Object({ y: T.String }))
    const predicate = T.hostValue<(value: unknown) => value is { x: number }>("isRow")
    // @ts-expect-error partially overlapping predicate complements are not proven exact
    T.ifGuard(T.predicate(predicate, overlap, row), function*() {}).elseGuard(function*() {})
    const subtype = yield* T.let("subtype", T.Union(T.Object({ x: T.Number, extra: T.Boolean }), T.String))
    // @ts-expect-error subtype predicates need a separate negative-narrowing proof
    T.ifGuard(T.predicate(predicate, subtype, row), function*() {}).elseGuard(function*() {})
    // @ts-expect-error an and propagates unsupported negative refinements
    T.ifGuard(T.allOf(T.predicate(predicate, overlap, row), T.notNullish(overlap)), function*() {}).elseGuard(function*() {})
    const opaque: T.Guard<string> = T.isTypeof(input, "string")
    // @ts-expect-error erasing a guard's refinement also erases its complement proof
    T.ifGuard(opaque, function*() {}).elseGuard(function*() {})
    const unknown = yield* T.let("unknown", T.Unknown)
    // @ts-expect-error unknown asserted types have a special native false branch
    T.ifGuard(T.predicate(T.hostValue<(value: unknown) => value is unknown>("isUnknown"), unknown, T.Unknown), function*() {}).elseGuard(
      function*() {},
    )
    // @ts-expect-error {} asserted types have a special native false branch
    T.ifGuard(T.predicate(T.hostValue<(value: unknown) => value is {}>("isEmpty"), unknown, T.Object({})), function*() {}).elseGuard(
      function*() {},
    )
    const nullish = T.predicate(
      T.hostValue<(value: unknown) => value is null | undefined>("isNullish"),
      unknown,
      T.Union(T.Null, T.Undefined),
    )
    // @ts-expect-error nullish asserted types have a special native false branch
    T.ifGuard(nullish, function*() {}).elseGuard(function*() {})
    const indexSignature = yield* T.let("indexSignature", T.Object({} as Record<string, typeof T.Number>))
    // @ts-expect-error native in narrowing does not remove index-signature members
    T.ifGuard(T.in(indexSignature, "x"), function*() {}).elseGuard(function*() {})
    const object = yield* T.let("object", T.NonPrimitive)
    // @ts-expect-error tsc reduces partially overlapping false-flow unions, unlike a declared union
    T.ifGuard(T.allOf(T.in(object, "first"), T.in(object, "second")), function*() {}).elseGuard(function*() {})
    const rows = yield* T.let("rows", T.Union(T.Object({ a: T.Optional(T.Number) }), T.Object({ b: T.String })))
    // @ts-expect-error an unlisted-property intersection overlaps the first false branch
    T.ifGuard(T.allOf(T.in(rows, "missing"), T.in(rows, "a")), function*() {}).elseGuard(function*() {})
    const tagged = yield* T.let("tagged", T.Union(T.Object({ kind: T.Literal("a") }), T.Object({ kind: T.Literal("b") })))
    // @ts-expect-error a later discriminant also creates partially overlapping false branches
    T.ifGuard(T.allOf(T.in(tagged, "value"), T.isEq(tagged, "kind", "a")), function*() {}).elseGuard(function*() {})
  }
  void unused
})
