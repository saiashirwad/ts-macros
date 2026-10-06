import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("ifGuard introduces a fresh annotated const without retyping the subject", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        yield* $.ifGuard($.isTypeof(input, "string"), function*(narrowed) {
          assertType<Equal<$.Denotes<typeof narrowed>, string>>()
          expectTypeOf<$.Denotes<typeof input>>().toEqualTypeOf<unknown>()
          assert.notEqual(input.id, narrowed.id)
          assert.equal(narrowed.mutable, false)
          yield* $.return(narrowed)
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
  $.build(function*() {
    const input = yield* $.let("input", $.Union($.Literal("yes"), $.Number, $.Null, $.Undefined))
    assert.ok(sameType($.isTypeof(input, "string").type, $.Literal("yes")))
    assert.ok(sameType($.isTypeof(input, "boolean").type, $.Never))
    assert.ok(sameType($.notNullish(input).type, $.Union($.Literal("yes"), $.Number)))
    const arrays = yield* $.let("arrays", $.Union($.Array($.Number), $.String))
    assert.ok(sameType($.isArray(arrays).type, $.Array($.Number)))
    yield* $.ifGuard($.isTypeof(input, "string"), function*(text) {
      yield* $.ifGuard($.notNullish(text), function*(nested) {
        assertType<Equal<$.Denotes<typeof nested>, "yes">>()
        yield* $.do(nested)
      })
    })
    return null
  })
})

test("a guarded property is read once, and else branches stay unnarrowed", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ value: $.Unknown }))],
      body: function*({ row }) {
        yield* $.ifGuard($.isTypeof($.prop(row, "value"), "string"), function*(value) {
          yield* $.return(value)
        }, "text").pipe(
          $.elseIf(false, function*() {
            yield* $.return(false)
          }),
          $.else(function*() {
            expectTypeOf<$.Denotes<typeof row>>().toEqualTypeOf<{ value: unknown }>()
            yield* $.return(0)
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("next", $.Function([], $.Unknown))],
      body: function*({ next }) {
        yield* $.ifGuard($.notNullish($.call(next)), function*(value) {
          assertType<Equal<$.Denotes<typeof value>, {}>>()
          yield* $.return(value)
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        yield* $.ifGuard($.isArray(input), function*(items) {
          assertType<Equal<$.Denotes<typeof items>, unknown[]>>()
          yield* $.return(items)
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("input", $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null))],
      body: function*({ input }) {
        yield* $.ifGuard($.allOf($.isArray(input), $.notNullish(input)), function*(items) {
          assertType<Equal<$.Denotes<typeof items>, readonly number[] | string[]>>()
          assert.ok(sameType(items.type!, $.Union($.ReadonlyArray($.Number), $.Array($.String))))
          yield* $.return(items)
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        yield* $.ifGuard($.isTypeof(input, "function"), function*(callable) {
          assertType<Equal<$.Denotes<typeof callable>, $.Typeof<unknown, "function">>>()
          assert.ok(sameType(callable.type!, $.External("Function")))
          yield* $.return(callable)
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
  $.build(function*() {
    const fn = $.Function([$.String], $.Number)
    const input = yield* $.let("input", $.Union(fn, $.Object({ x: $.Number }), $.Null))
    assert.ok(sameType($.isTypeof(input, "function").type, fn))
    assert.ok(sameType($.isTypeof(input, "object").type, $.Union($.Object({ x: $.Number }), $.Null)))
    return null
  })
})

test("instanceOf emits the constructor test and saves a property subject once", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ value: $.Unknown }))],
      body: function*({ row }) {
        yield* $.ifGuard($.instanceOf($.prop(row, "value"), $.hostValue<typeof Date>("Date"), $.External<Date>("Date")), function*(date) {
          assertType<Equal<$.Denotes<typeof date>, Date>>()
          yield* $.return(date)
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ value: $.Unknown }))],
      body: function*({ row }) {
        return yield* $.guard(
          $.predicate($.hostValue<(value: unknown) => value is string>("isText"), $.prop(row, "value"), $.String),
          function*() {
            yield* $.return(false)
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
    const input = yield* $.let("input", $.Unknown)
    const ctor = $.hostValue<typeof Date>("Date")
    const date = $.External<Date>("Date")
    const isDate = $.hostValue<(value: unknown) => value is Date>("isDate")
    // @ts-expect-error instanceOf needs a constructor, not a function
    $.instanceOf(input, $.hostValue<() => Date>("factory"), date)
    // @ts-expect-error the witness must equal the constructor's instance type
    $.instanceOf(input, ctor, $.String)
    // @ts-expect-error ordinary boolean functions are not predicates
    $.predicate($.hostValue<(value: unknown) => boolean>("test"), input, date)
    // @ts-expect-error the witness must equal the predicate's asserted type
    $.predicate(isDate, input, $.String)
    // @ts-expect-error the predicate's parameter must accept the subject
    $.predicate($.hostValue<(value: string | number) => value is string>("isText"), input, $.String)
    const union = yield* $.let("union", $.Union(date, $.String))
    // @ts-expect-error constructor narrowing is not modeled for arbitrary unions
    $.instanceOf(union, ctor, date)
    const overlaps = yield* $.let("overlaps", $.Union($.Object({ y: $.String }), $.Object({ z: $.Number })))
    // @ts-expect-error predicate union overlap without an assignable member is deferred
    $.predicate(isDate, overlaps, date)
    // @ts-expect-error a custom prototype changes native instanceof narrowing
    $.instanceOf(input, $.hostValue<(abstract new() => Date) & { prototype: { x: number } }>("Odd"), date)
    // @ts-expect-error custom hasInstance predicates change the narrowing target
    $.instanceOf(input, $.hostValue<(abstract new() => Date) & { [Symbol.hasInstance]: (value: unknown) => value is string }>("Odd"), date)
    // @ts-expect-error overload resolution could pick a different asserted type
    $.predicate($.hostValue<{ (value: unknown): value is string; (value: unknown): value is number }>("overloaded"), input, $.Number)
    const readonlyItems = yield* $.let("readonlyItems", $.ReadonlyArray($.Number))
    // @ts-expect-error index writes through readonly arrays are rejected
    $.assign($.index(readonlyItems, 0), 1)
    const mixedItems = yield* $.let("mixedItems", $.Union($.ReadonlyArray($.Number), $.Array($.Number)))
    // @ts-expect-error every possible receiver must allow an index write
    $.assign($.index(mixedItems, 0), 1)
  }
  void unused
})

test("a narrowed alias cannot resolve outside its branch or in an else branch", () => {
  for (const inElse of [false, true]) {
    assert.throws(() =>
      $.build(function*() {
        let escaped: $.Ref<string, false> | undefined
        const input = yield* $.let("input", $.Unknown)
        const builder = $.ifGuard($.isTypeof(input, "string"), function*(value) {
          escaped = value
        })
        if (inElse) {
          yield* builder.pipe($.else(function*() {
            yield* $.do(escaped!)
          }))
        } else {
          yield* builder
          yield* $.do(escaped!)
        }
        return null
      }), /does not resolve to an in-scope binding/)
  }
})

test("guard builders remain lazy and repeated yields use independent bindings", () => {
  let runs = 0
  const ids: $.Ref<string, false>["id"][] = []
  const program = $.build(function*() {
    const input = yield* $.let("input", $.Unknown)
    const builder = $.ifGuard($.isTypeof(input, "string"), function*(value) {
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
  $.build(function*() {
    const fn = yield* $.fn("read", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        yield* $.ifGuard($.isTypeof(input, "number"), function*(value) {
          yield* $.return(value)
        }).pipe($.else(function*() {
          yield* $.return(false)
        }))
        return "done"
      },
    })
    assertType<Equal<ReturnType<$.Denotes<typeof fn>>, number | false | "done">>()
    const input = yield* $.let("input", $.Unknown)
    yield* $.while(true, function*() {
      yield* $.ifGuard($.notNullish(input), function*() {
        yield* $.break()
        yield* $.continue()
      })
    })
    return null
  })
  const unused = function*() {
    const input = yield* $.let("input", $.Unknown)
    const loopOnly = $.ifGuard($.notNullish(input), function*() {
      yield* $.break()
    })
    // @ts-expect-error loop-only statements cannot escape to a program body
    $.build(function*() {
      yield* loopOnly
    })
    // @ts-expect-error the invariant yielded statement set cannot erase break
    const erased: $.IfBuilder<$.NonLoopStatement> = loopOnly
    void erased
    const closed = $.ifGuard($.notNullish(input), function*() {}).pipe($.else(function*() {}))
    // @ts-expect-error else closes a guarded builder too
    closed.pipe($.elseIf(true, function*() {}))
  }
  void unused
})

test("guard misuse is rejected rather than assigning an inaccurate denotation", () => {
  const unused = function*() {
    const input = yield* $.let("input", $.Unknown)
    // @ts-expect-error invalid typeof tag
    $.isTypeof(input, "date")
    $.isTypeof(input, "function")
    const tag: "string" | "number" = Math.random() < 0.5 ? "string" : "number"
    // @ts-expect-error a stage-1 union tag would make the emitted annotation branch-dependent
    $.isTypeof(input, tag)
    yield* $.ifGuard($.isTypeof(input, "string"), function*(value) {
      // @ts-expect-error the alias is const
      $.assign(value, "other")
    })
    // @ts-expect-error structural object members could also be arrays
    $.isArray($.hostValue<number[] | { x: number }>("items"))
    // @ts-expect-error {} includes primitives, so Extract would not model typeof narrowing
    $.isTypeof($.hostValue<{}>("empty"), "string")
    // @ts-expect-error any is not a concrete subject denotation
    $.isTypeof($.hostValue<any>("unchecked"), "number")
    const T = $.TypeParam("T")
    const { symbolic } = $.paramBindings([$.param("symbolic", T)])
    // @ts-expect-error symbolic narrowing is not supported by this phase
    $.notNullish(symbolic)
  }
  void unused
  assert.throws(() => $.isTypeof($.hostValue<unknown>("input"), "string"), /needs subject type metadata/)
})

test("and reapplies refinements, short circuits, and saves a shared subject once", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("next", $.Function([], $.Unknown))],
      body: function*({ next }) {
        const subject = $.call(next)
        const combined = $.allOf($.isTypeof(subject, "object"), $.notNullish(subject))
        assert.ok(sameType(combined.type, $.NonPrimitive))
        yield* $.ifGuard(combined, function*(value) {
          assertType<Equal<$.Denotes<typeof value>, object>>()
          yield* $.return(value)
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
  $.build(function*() {
    const first = yield* $.let("first", $.Unknown)
    const second = yield* $.let("second", $.Unknown)
    assert.throws(() => $.allOf($.isTypeof(first, "object"), $.notNullish(second)), /same subject node/)
    return null
  })
})

test("hasOwn preserves the object type while in narrows property presence", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("input", $.NonPrimitive)],
      body: function*({ input }) {
        yield* $.ifGuard($.hasOwn(input, "value"), function*(owned) {
          assertType<Equal<$.Denotes<typeof owned>, object>>()
          yield* $.do(owned)
        }, "owned")
        yield* $.ifGuard($.in(input, "value"), function*(present) {
          assertType<Equal<$.Denotes<typeof present>, object & Record<"value", unknown>>>()
          yield* $.return($.prop(present, "value"))
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
  const program = $.build(function*() {
    return yield* $.fn("owns", {
      params: [$.param("input", $.NonPrimitive)],
      body: function*({ input }) {
        for (const key of ["value", "missing"]) {
          const guard = $.hasOwn(input, key)
          assert.ok(sameType(guard.type, $.NonPrimitive))
          yield* $.ifGuard(guard, function*(owned) {
            assertType<Equal<$.Denotes<typeof owned>, object>>()
            yield* $.return(true)
          })
        }
        const unionKey: "value" | "missing" = Math.random() < 0.5 ? "value" : "missing"
        const unionGuard = $.hasOwn(input, unionKey)
        assert.ok(sameType(unionGuard.type, $.NonPrimitive))
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
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param(
        "input",
        $.Union(
          $.Object({ kind: $.Literal("text"), value: $.String }),
          $.Object({ kind: $.Literal("number"), value: $.Number }),
          $.Object({ kind: $.Literal("empty") }),
        ),
      )],
      body: function*({ input }) {
        yield* $.ifGuard($.isEq(input, "kind", "text"), function*(text) {
          assertType<Equal<$.Denotes<typeof text>, { kind: "text"; value: string }>>()
          yield* $.return($.prop(text, "value"))
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

test("discriminant refinements and complements require present, required literal fields", () => {
  const { input } = $.paramBindings([$.param(
    "input",
    $.Union($.Object({ kind: $.Literal("text") }), $.Object({ kind: $.Literal("number") })),
  )])
  const guard = $.isEq(input, "kind", "text")
  for (const transform of [guard.refine, guard.reject]) {
    assert.throws(() => transform($.Object({})), /a discriminant guard needs the discriminant on every member/)
    for (const type of [$.Object({ kind: $.Optional($.Literal("text")) }), $.Object({ kind: $.String })]) {
      assert.throws(() => transform(type), /a discriminant guard needs required single-literal fields/)
    }
  }
})

test("guard clauses expose a const after an exiting failure body and hoist once", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ value: $.Unknown }))],
      body: function*({ row }) {
        const text = yield* $.guard($.isTypeof($.prop(row, "value"), "string"), function*() {
          yield* $.return(false)
        }, "text")
        assertType<Equal<$.Denotes<typeof text>, string>>()
        yield* $.do(text)
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
      yield* $.do(false)
    }]
  ) {
    assert.throws(() =>
      $.build(function*() {
        const input = yield* $.let("input", $.Unknown)
        yield* $.guard($.notNullish(input), failure)
        return null
      }), /failure body must end with return, throw, break, or continue/)
  }
})

test("guard clause yields preserve returns, loop restrictions, and laziness", () => {
  let runs = 0
  const ids: $.Ref<string, false>["id"][] = []
  $.build(function*() {
    const fn = yield* $.fn("read", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        const builder = $.guard($.isTypeof(input, "string"), function*() {
          runs++
          yield* $.return(false)
        })
        assert.equal(runs, 0)
        const first = yield* builder
        const second = yield* builder
        ids.push(first.id, second.id)
        return first
      },
    })
    assertType<Equal<ReturnType<$.Denotes<typeof fn>>, string | false>>()
    const input = yield* $.let("input", $.Unknown)
    yield* $.while(true, function*() {
      const value = yield* $.guard($.notNullish(input), function*() {
        yield* $.continue()
      })
      yield* $.do(value)
      yield* $.guard($.notNullish(input), function*() {
        yield* $.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  const unused = function*() {
    const input = yield* $.let("input", $.Unknown)
    for (const exit of [$.break, $.continue]) {
      const builder = $.guard($.notNullish(input), function*() {
        yield* exit()
      })
      // @ts-expect-error loop-only guard failures cannot escape to a program body
      $.build(function*() {
        yield* builder
      })
      $.fn("invalid", {
        // @ts-expect-error loop-only guard failures cannot escape to a function body
        body: function*() {
          yield* builder
          return false
        },
      })
      // @ts-expect-error invariant yields cannot erase the loop-only statements
      const erased: $.GuardBuilder<{}, $.NonLoopStatement> = builder
      void erased
    }
  }
  void unused
})

test("phase 2 guard misuse is rejected at type level", () => {
  const unused = function*() {
    const input = yield* $.let("input", $.Unknown)
    // @ts-expect-error hasOwn requires an already-object subject
    $.hasOwn(input, "x")
    // @ts-expect-error in requires an already-object subject
    $.in(input, "x")
    const one = yield* $.let("one", $.Object({ kind: $.Literal("a") }))
    // @ts-expect-error a single object is not a discriminated union
    $.isEq(one, "kind", "a")
    const broad = yield* $.let(
      "broad",
      $.Union($.Object({ kind: $.String, x: $.Number }), $.Object({ kind: $.String, y: $.Number })),
    )
    // @ts-expect-error broad strings are not literal discriminants
    $.isEq(broad, "kind", "a")
    const optional = yield* $.let(
      "optional",
      $.Union($.Object({ kind: $.Optional($.Literal("a")) }), $.Object({ kind: $.Literal("b") })),
    )
    // @ts-expect-error discriminants must be required on every member
    $.isEq(optional, "kind", "a")
    const union = yield* $.let("union", $.Union($.Object({ kind: $.Literal("a") }), $.Object({ kind: $.Literal("b") })))
    // @ts-expect-error the key must be a discriminant shared by every member
    $.isEq(union, "missing", "a")
    // @ts-expect-error the value must match a discriminant
    $.isEq(union, "kind", "c")
    const literal: "a" | "b" = Math.random() < 0.5 ? "a" : "b"
    // @ts-expect-error stage-1 union values do not describe one emitted narrowing
    $.isEq(union, "kind", literal)
    // @ts-expect-error the right equality would produce TS2367 after the left one narrows to "a"
    $.allOf($.isEq(union, "kind", "a"), $.isEq(union, "kind", "b"))
    const mixed = yield* $.let(
      "mixed",
      $.Union($.Object({ kind: $.Union($.Literal("a"), $.Literal("b")) }), $.Object({ kind: $.Literal("c") })),
    )
    // @ts-expect-error each member must have one literal discriminant, not a union
    $.isEq(mixed, "kind", "a")
    const templated = yield* $.let(
      "templated",
      $.Union(
        $.Object({ kind: $.Template(["field", ""], $.Number) }),
        $.Object({ kind: $.Literal("other") }),
      ),
    )
    // @ts-expect-error an infinite template pattern is not a literal discriminant
    $.isEq(templated, "kind", "field1")
    const key: "x" | "y" = Math.random() < 0.5 ? "x" : "y"
    // @ts-expect-error in needs one literal key
    $.in(one, key)
    const pattern: `field${number}` = `field${Math.random()}`
    // @ts-expect-error an infinite template pattern is not one literal key
    $.in(one, pattern)
    // @ts-expect-error refinement cannot model Array.isArray(object) as Extract<object, unknown[]>
    $.allOf($.isTypeof(input, "object"), $.isArray(input))
    yield* $.guard($.isTypeof(input, "string"), function*() {
      yield* $.throw("not text")
    })
    const text = yield* $.guard($.isTypeof(input, "string"), function*() {
      yield* $.throw("not text")
    })
    // @ts-expect-error the guard-clause alias is const
    $.assign(text, "other")
  }
  void unused
})

test("elseGuard emits a fresh complement alias and saves property subjects once", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ value: $.Union($.String, $.Number, $.Null) }))],
      body: function*({ row }) {
        yield* $.ifGuard($.isTypeof($.prop(row, "value"), "string"), function*(text) {
          yield* $.return(text)
        }, "text").elseGuard(function*(rest) {
          assertType<Equal<$.Denotes<typeof rest>, number | null>>()
          assert.equal(rest.mutable, false)
          yield* $.return(rest)
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
  $.build(function*() {
    const arrays = yield* $.let("arrays", $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null))
    yield* $.ifGuard($.isArray(arrays), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<$.Denotes<typeof rest>, readonly number[] | null>>()
      yield* $.do(rest)
    }, "notMutable")
    const input = yield* $.let("input", $.Unknown)
    yield* $.ifGuard($.notNullish(input), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<$.Denotes<typeof rest>, null | undefined>>()
      yield* $.do(rest)
    })
    yield* $.ifGuard($.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<$.Denotes<typeof rest>, unknown>>()
      yield* $.do(rest)
    })
    const optional = yield* $.let("optional", $.Union($.Object({ a: $.Optional($.Number) }), $.Object({ b: $.String })))
    yield* $.ifGuard($.in(optional, "a"), function*() {}).elseGuard(function*(rest) {
      assertType<Equal<$.Denotes<typeof rest>, { a?: number } | { b: string }>>()
      yield* $.do(rest)
    })
    return null
  })
})

test("elseGuard remains lazy, preserves returns and loop yields, and scopes aliases", () => {
  let runs = 0
  const ids: $.Ref<number, false>["id"][] = []
  $.build(function*() {
    const input = yield* $.let("input", $.Union($.String, $.Number))
    const builder = $.ifGuard($.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
      runs++
      ids.push(rest.id)
    })
    assert.equal(runs, 0)
    yield* builder
    yield* builder
    const fn = yield* $.fn("read", {
      params: [$.param("value", $.Union($.String, $.Number))],
      body: function*({ value }) {
        yield* $.ifGuard($.isTypeof(value, "string"), function*(text) {
          yield* $.return(text)
        }).elseGuard(function*(rest) {
          yield* $.return(rest)
        })
        return false
      },
    })
    assertType<Equal<ReturnType<$.Denotes<typeof fn>>, string | number | false>>()
    yield* $.while(true, function*() {
      yield* $.ifGuard($.isTypeof(input, "string"), function*() {}).elseGuard(function*() {
        yield* $.break()
      })
    })
    return null
  })
  assert.equal(runs, 2)
  assert.notEqual(ids[0], ids[1])
  assert.throws(() =>
    $.build(function*() {
      let escaped: $.Ref<number, false> | undefined
      const input = yield* $.let("input", $.Union($.String, $.Number))
      yield* $.ifGuard($.isTypeof(input, "string"), function*() {}).elseGuard(function*(rest) {
        escaped = rest
      })
      yield* $.do(escaped!)
      return null
    }), /does not resolve to an in-scope binding/)
})

test("unsupported complements and elseGuard misuse are rejected", () => {
  const unused = function*() {
    const input = yield* $.let("input", $.Union($.String, $.Number))
    const builder = $.ifGuard($.isTypeof(input, "string"), function*() {})
    builder.elseGuard(function*(rest) {
      // @ts-expect-error negative aliases are const too
      $.assign(rest, 1)
    })
    // @ts-expect-error non-guard if builders have no complement
    $.if(true, function*() {}).elseGuard(function*() {})
    const closed = builder.elseGuard(function*() {})
    // @ts-expect-error elseGuard closes the builder
    closed.elseGuard(function*() {})
    // @ts-expect-error double else is rejected
    closed.pipe($.else(function*() {}))
    // @ts-expect-error double else in the opposite order is rejected
    builder.pipe($.else(function*() {})).elseGuard(function*() {})
    // @ts-expect-error later elseIf tests are intentionally not modeled
    builder.pipe($.elseIf(true, function*() {})).elseGuard(function*() {})
    const loop = builder.elseGuard(function*() {
      yield* $.continue()
    })
    // @ts-expect-error loop-only negative branches cannot escape their loop
    $.build(function*() {
      yield* loop
    })
    const row = $.Object({ x: $.Number })
    const overlap = yield* $.let("overlap", $.Object({ y: $.String }))
    const predicate = $.hostValue<(value: unknown) => value is { x: number }>("isRow")
    // @ts-expect-error partially overlapping predicate complements are not proven exact
    $.ifGuard($.predicate(predicate, overlap, row), function*() {}).elseGuard(function*() {})
    const subtype = yield* $.let("subtype", $.Union($.Object({ x: $.Number, extra: $.Boolean }), $.String))
    // @ts-expect-error subtype predicates need a separate negative-narrowing proof
    $.ifGuard($.predicate(predicate, subtype, row), function*() {}).elseGuard(function*() {})
    // @ts-expect-error an and propagates unsupported negative refinements
    $.ifGuard($.allOf($.predicate(predicate, overlap, row), $.notNullish(overlap)), function*() {}).elseGuard(function*() {})
    const opaque: $.Guard<string> = $.isTypeof(input, "string")
    // @ts-expect-error erasing a guard's refinement also erases its complement proof
    $.ifGuard(opaque, function*() {}).elseGuard(function*() {})
    const unknown = yield* $.let("unknown", $.Unknown)
    // @ts-expect-error unknown asserted types have a special native false branch
    $.ifGuard($.predicate($.hostValue<(value: unknown) => value is unknown>("isUnknown"), unknown, $.Unknown), function*() {}).elseGuard(
      function*() {},
    )
    // @ts-expect-error {} asserted types have a special native false branch
    $.ifGuard($.predicate($.hostValue<(value: unknown) => value is {}>("isEmpty"), unknown, $.Object({})), function*() {}).elseGuard(
      function*() {},
    )
    const nullish = $.predicate(
      $.hostValue<(value: unknown) => value is null | undefined>("isNullish"),
      unknown,
      $.Union($.Null, $.Undefined),
    )
    // @ts-expect-error nullish asserted types have a special native false branch
    $.ifGuard(nullish, function*() {}).elseGuard(function*() {})
    const indexSignature = yield* $.let("indexSignature", $.Object({} as Record<string, typeof $.Number>))
    // @ts-expect-error native in narrowing does not remove index-signature members
    $.ifGuard($.in(indexSignature, "x"), function*() {}).elseGuard(function*() {})
    const object = yield* $.let("object", $.NonPrimitive)
    // @ts-expect-error tsc reduces partially overlapping false-flow unions, unlike a declared union
    $.ifGuard($.allOf($.in(object, "first"), $.in(object, "second")), function*() {}).elseGuard(function*() {})
    const rows = yield* $.let("rows", $.Union($.Object({ a: $.Optional($.Number) }), $.Object({ b: $.String })))
    // @ts-expect-error an unlisted-property intersection overlaps the first false branch
    $.ifGuard($.allOf($.in(rows, "missing"), $.in(rows, "a")), function*() {}).elseGuard(function*() {})
    const tagged = yield* $.let("tagged", $.Union($.Object({ kind: $.Literal("a") }), $.Object({ kind: $.Literal("b") })))
    // @ts-expect-error a later discriminant also creates partially overlapping false branches
    $.ifGuard($.allOf($.in(tagged, "value"), $.isEq(tagged, "kind", "a")), function*() {}).elseGuard(function*() {})
  }
  void unused
})
