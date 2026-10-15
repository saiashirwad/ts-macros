import assert from "node:assert/strict"
import { test } from "node:test"

import { type C, c, type Converted, cTarget, type Double, emitC, type Int, type Ptr } from "../languages/c.ts"
import { emitTs, type TS, ts, tsTarget, type TsTruthy } from "../languages/typescript.ts"
import * as lang from "../src/lang/index.ts"
import { assertType, type Equal } from "./typing.ts"

const i8 = (value: number) => c.literal(c.int(8), value)
const i32 = (value: number) => c.literal(c.int(32), value)
const u32 = (value: number) => c.literal(c.uint(32), value)
const f64 = (value: number) => c.literal(c.double, value)

test("rules compose from combinators, and only an exact true accepts", () => {
  interface Pointee extends lang.TypeLambda {
    readonly type: this["Args"] extends readonly [Ptr<infer T>] ? [T] : never
  }
  type PointerAssign = lang.Under<Pointee, lang.Same>
  assertType<Equal<lang.Kind<PointerAssign, [Ptr<Int<32>>, Ptr<Int<32>>]>, true>>()
  assertType<Equal<lang.Kind<PointerAssign, [Ptr<Int<32>>, Ptr<Double>]>, false>>()
  assertType<Equal<lang.Kind<PointerAssign, [Int<32>, Int<32>]>, false>>()
  assertType<Equal<lang.Kind<lang.Not<lang.Assignable>, [string, number]>, true>>()
  assertType<Equal<lang.Kind<lang.Not<lang.Assignable>, [1, number]>, false>>()
  assertType<Equal<lang.Kind<lang.AnyOf<lang.Both<string>, lang.Assignable>, [1, number]>, true>>()
  assertType<Equal<lang.Kind<lang.Assignable & lang.Both<string>, [1, number]>, never>>()
  assertType<Equal<lang.Accepts<never>, false>>()
  assertType<Equal<lang.Accepts<boolean>, false>>()
})

test("C: conversions and promotions follow C's rules, not TypeScript's", () => {
  const sum = c.add(i8(1), i8(2))
  assertType<Equal<lang.Denotes<typeof sum>, Int<32, true>>>()
  const mixed = c.add(u32(1), i32(2))
  assertType<Equal<lang.Denotes<typeof mixed>, Int<32, false>>>()
  const wide = c.add(c.literal(c.int(64), 1), i8(2))
  assertType<Equal<lang.Denotes<typeof wide>, Int<64, true>>>()
  const real = c.add(i32(1), f64(2))
  assertType<Equal<lang.Denotes<typeof real>, Double>>()
  const compared = c.less(i8(1), f64(2))
  assertType<Equal<lang.Denotes<typeof compared>, Int<32, true>>>()
  assertType<Equal<Converted<Int<8, false>, Int<8, false>>, Int<32, true>>>()
  assertType<Equal<Converted<Int<16, false>, Int<32, true>>, Int<32, true>>>()
  assertType<Equal<Converted<Int<16, false>, Int<32, false>>, Int<32, false>>>()
  assertType<Equal<Converted<Int<32, false>, Int<64, true>>, Int<64, true>>>()
  assertType<Equal<Converted<Int<64, false>, Int<32, true>>, Int<64, false>>>()
  assertType<Equal<Converted<Int<64, true>, Int<64, false>>, Int<64, false>>>()

  c.program(function*() {
    yield* c.fn("main", [], c.void, function*() {
      const n = yield* c.let("n", i8(1), c.int(32))
      yield* c.let("wide", n, c.int(64))
      // @ts-expect-error a C binding needs a declared type
      yield* c.let("untyped", n)
      yield* c.let("real", n, c.double)
      yield* c.let("narrow", f64(2), c.int(8))
      const p = yield* c.let("p", c.address(n), c.ptr(c.int(32)))
      const q = c.add(p, i32(1))
      assertType<Equal<lang.Denotes<typeof q>, Ptr<Int<32, true>>>>()
      const flipped = c.add(i32(1), p)
      assertType<Equal<lang.Denotes<typeof flipped>, Ptr<Int<32, true>>>>()
      yield* c.let("q", q, c.ptr(c.int(32)))
      yield* c.let("m", c.deref(p), c.int(32))
      // @ts-expect-error int* to double* needs a cast in C
      yield* c.let("r", p, c.ptr(c.double))
      // @ts-expect-error int32_t* to uint32_t* needs a cast in C
      yield* c.let("u", p, c.ptr(c.uint(32)))
      // @ts-expect-error an int is not a pointer
      yield* c.let("s", n, c.ptr(c.int(32)))
      // @ts-expect-error a pointer is not arithmetic
      yield* c.let("t", p, c.int(32))
      // @ts-expect-error only a pointer can be dereferenced
      c.deref(n)
      // @ts-expect-error two pointers cannot be added
      c.add(p, p)
      // @ts-expect-error a double cannot be added to a pointer
      c.add(p, f64(1))
      // @ts-expect-error a pointer cannot be compared with an int
      c.less(p, n)
      yield* c.if(p, function*() {})
      yield* c.while(c.less(n, i32(10)), function*() {
        yield* c.assign(n, c.add(n, i32(1)))
      })
      // @ts-expect-error a value is not assignable to a pointer binding
      yield* c.assign(p, n)
    })
  })
})

test("C: function bodies and calls are checked against declarations", () => {
  c.program(function*() {
    const square = yield* c.fn("square", [c.param("x", c.int(32))], c.int(64), function*(x) {
      yield* c.if(c.less(x, i32(0)), function*() {
        yield* c.return(i32(0))
      })
      yield* c.return(c.add(x, x))
    })
    yield* c.fn("main", [], c.void, function*() {
      yield* c.let("nine", c.call(square, i32(3)), c.int(64))
    })
    c.call(square, f64(3))
    // @ts-expect-error a pointer argument does not convert to an int parameter
    c.call(square, c.address(c.call(square, i32(1))))
    // @ts-expect-error too many arguments
    c.call(square, i32(1), i32(2))
    // @ts-expect-error too few arguments
    c.call(square)
    // @ts-expect-error a pointer is returned from a function declared to return an int, even from a nested branch
    yield* c.fn(
      "leak",
      [c.param("p", c.ptr(c.int(32)))],
      c.int(32),
      function*(p) {
        yield* c.if(p, function*() {
          yield* c.return(p)
        })
        yield* c.return(i32(0))
      },
    )
  })
})

test("TypeScript: the same constructs follow TypeScript's rules", () => {
  ts.program(function*() {
    const total = yield* ts.let("total", ts.literal(1), ts.number)
    // @ts-expect-error a string is not assignable to number
    yield* ts.let("wrong", ts.literal("one"), ts.number)
    const label = ts.add(ts.literal("n = "), total)
    assertType<Equal<lang.Denotes<typeof label>, string>>()
    // @ts-expect-error a boolean cannot be added to a number
    ts.add(total, ts.literal(true))
    yield* ts.if(ts.literal("text"), function*() {})
    const log = yield* ts.fn("log", [ts.param("message", ts.string)], ts.void, function*() {})
    // @ts-expect-error void cannot be a condition
    yield* ts.if(ts.call(log, ts.literal("x")), function*() {})
    assertType<Equal<lang.Kind<TsTruthy, [undefined]>, true>>()
    assertType<Equal<lang.Kind<TsTruthy, [any]>, true>>()
    // @ts-expect-error a string is returned from a function declared to return a number
    yield* ts.fn(
      "describe",
      [ts.param("n", ts.number)],
      ts.number,
      function*(n) {
        yield* ts.return(ts.add(ts.literal("n = "), n))
      },
    )
  })
})

export const languagesNeverMix = () => {
  const tsInt = lang.ref<TS, Int<32, true>>(lang.binding("tsInt"), ts.number)
  const cNumber = lang.ref<C, number>(lang.binding("cNumber"), c.double)
  const tsNumber = lang.ref<TS, number>(lang.binding("tsNumber"), ts.number)
  c.program(function*() {
    yield* c.let("x", c.literal(c.int(32), 1), c.int(32))
    // @ts-expect-error a TypeScript expression cannot initialize a C binding
    yield* c.let("y", tsInt, c.int(32))
  })
  ts.add(tsNumber, tsNumber)
  // @ts-expect-error a C expression cannot be added in TypeScript
  ts.add(tsNumber, cNumber)
  const tsIntType = lang.typeNode<TS, Int<32, true>, { readonly kind: "int-type" }>(lang.typeClass(), { kind: "int-type" })
  // @ts-expect-error a TypeScript type cannot declare a C binding
  c.let("z", i32(1), tsIntType)
  // @ts-expect-error a C statement cannot appear in a TypeScript program
  ts.program(function*() {
    yield* c.run(cNumber)
  })
}

test("a language without a capability cannot instantiate a construct that needs it", () => {
  type Logic = { readonly name: "logic"; readonly Assign: lang.AnyOf<lang.Assignable, lang.Both<string>> }
  lang.letConstruct<Logic>()
  // @ts-expect-error Logic has no Truthy rule, which `if` needs
  lang.ifConstruct<Logic>()
  // @ts-expect-error Logic has no Sum rule, which `add` needs
  lang.addConstruct<Logic>()
})

const counter = () =>
  c.program(function*() {
    yield* c.fn("count", [c.param("limit", c.int(32))], c.int(32), function*(limit) {
      const i = yield* c.let("i", i32(0), c.int(32))
      yield* c.while(c.less(i, limit), function*() {
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(i)
    })
  })

test("emit requires a handler for every kind a program uses, nested kinds included", () => {
  const program = counter()
  assertType<
    Equal<
      typeof program,
      lang.Program<C, "function" | "int-type" | "let" | "literal" | "while" | "less" | "ref" | "assign" | "add" | "return">
    >
  >()
  const { less: _less, ...withoutLess } = cTarget.handlers
  lang.emit(program, lang.defineTarget(cTarget.naming, { ...withoutLess, less: cTarget.handlers.less, extra: () => "" }))
  // @ts-expect-error target has no handler for "less", which is only used in a nested while condition
  assert.throws(() => lang.emit(program, lang.defineTarget(cTarget.naming, withoutLess)), /target has no handler for "less"/)
})

test("the C target emits C source", () => {
  assert.equal(
    emitC(counter()),
    `#include <stdint.h>

int32_t count(int32_t limit) {
  int32_t i = 0;
  while (i < limit) {
    i = i + 1;
  }
  return i;
}
`,
  )
  const pointers = c.program(function*() {
    yield* c.fn("main", [], c.int(32), function*() {
      const x = yield* c.let("int", f64(2), c.double)
      const p = yield* c.let("p", c.address(x), c.ptr(c.double))
      yield* c.let("byte", c.literal(c.uint(8), 255), c.uint(8))
      yield* c.return(c.add(c.deref(p), i32(1)))
    })
  })
  assert.equal(
    emitC(pointers),
    `#include <stdint.h>

int32_t main(void) {
  double int_2 = 2.0;
  double* p = &int_2;
  uint8_t byte = 255;
  return *p + 1;
}
`,
  )
})

test("C literals are spelled with their declared type, and must fit it", () => {
  const program = c.program(function*() {
    yield* c.let("int32_t", c.less(u32(1), i32(-1)), c.int(32))
    yield* c.let("INT64_C", c.add(c.literal(c.int(64), -5), c.literal(c.uint(64), 9007199254740991)), c.int(64))
    yield* c.let("min", i32(-2147483648), c.int(32))
    yield* c.let("small", c.add(c.literal(c.uint(16), 65535), c.literal(c.int(8), -128)), c.int(32))
    yield* c.let("big", f64(1e21), c.double)
    yield* c.let("tiny", f64(-1.5e-7), c.double)
    yield* c.let("negativeZero", f64(-0), c.double)
    yield* c.let("notANumber", c.add(f64(NaN), f64(1)), c.double)
    yield* c.let("infinity", c.less(f64(-Infinity), f64(Infinity)), c.double)
  })
  assert.equal(
    emitC(program),
    `#include <stdint.h>

int32_t int32_t_2 = UINT32_C(1) < -1;
int64_t INT64_C_2 = -INT64_C(5) + UINT64_C(9007199254740991);
int32_t min = INT32_MIN;
int32_t small = 65535 + -128;
double big = 1e+21;
double tiny = -1.5e-7;
double negativeZero = -0.0;
double notANumber = 0.0 / 0.0 + 1.0;
double infinity = -1.0 / 0.0 < 1.0 / 0.0;
`,
  )
  assert.throws(() => c.literal(c.int(8), 300), /int8_t cannot hold the literal 300 exactly/)
  assert.throws(() => c.literal(c.int(32), 1.5), /int32_t cannot hold the literal 1.5 exactly/)
  assert.throws(() => c.literal(c.uint(8), -1), /uint8_t cannot hold the literal -1 exactly/)
  assert.throws(() => c.literal(c.int(64), 2 ** 53), /int64_t cannot hold the literal 9007199254740992 exactly/)
})

test("the TypeScript target spells numbers that String() does not", () => {
  const program = ts.program(function*() {
    yield* ts.let("NaN", ts.literal(NaN), ts.number)
    yield* ts.let("Infinity", ts.add(ts.literal(Infinity), ts.literal(-Infinity)), ts.number)
    yield* ts.let("zero", ts.literal(-0), ts.number)
  })
  assert.equal(
    emitTs(program),
    `let NaN: number = 0 / 0;
let Infinity: number = 1 / 0 + -1 / 0;
let zero: number = -0;`,
  )
})

test("the TypeScript target emits TypeScript source with renamed clashes", () => {
  const program = ts.program(function*() {
    const add = yield* ts.fn("add", [ts.param("a", ts.number), ts.param("a", ts.number)], ts.number, function*(a, b) {
      yield* ts.return(ts.add(a, b))
    })
    const total = yield* ts.let("class", ts.call(add, ts.literal(1), ts.literal(-2)), ts.number)
    yield* ts.if(ts.less(total, ts.literal(0)), function*() {
      yield* ts.assign(total, ts.literal(0))
    }, function*() {
      yield* ts.run(ts.call(add, total, total))
    })
  })
  assert.equal(
    emitTs(program),
    `function add(a: number, a_2: number): number {
  return a + a_2;
}
let class_2: number = add(1, -2);
if (class_2 < 0) {
  class_2 = 0;
} else {
  add(class_2, class_2);
}`,
  )
})

test("a target's naming policy decides how bindings are spelled", () => {
  const program = ts.program(function*() {
    yield* ts.let("count", ts.literal(1), ts.number)
  })
  const shouting = lang.defineTarget({ ...tsTarget.naming, spell: (hint) => hint.toUpperCase() }, tsTarget.handlers)
  assert.equal(lang.emit(program, shouting), "let COUNT: number = 1;")
  const invalid = ts.program(function*() {
    yield* ts.let("not a name", ts.literal(1), ts.number)
  })
  assert.throws(() => emitTs(invalid), /cannot emit invalid identifier "not a name"/)
})

test("build rejects references that escape their scope, and C rejects top-level statements", () => {
  let escaped: lang.Ref<TS, number> | undefined
  ts.program(function*() {
    yield* ts.if(ts.literal(true), function*() {
      escaped = yield* ts.let("inner", ts.literal(1), ts.number)
    })
  })
  assert.throws(
    () =>
      ts.program(function*() {
        yield* ts.run(escaped!)
      }),
    /reference to "inner" does not resolve to an in-scope binding/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.run(i32(1))
      }),
    /"expression" cannot appear at the top level of a C program/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.fn("outer", [], c.void, function*() {
          yield* c.if(i32(1), function*() {
            yield* c.fn("inner", [], c.void, function*() {})
          })
        })
      }),
    /function "inner" cannot be nested in another function in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const one = yield* c.fn("one", [], c.int(32), function*() {
          yield* c.return(i32(1))
        })
        yield* c.let("x", c.call(one), c.int(32))
      }),
    /the top-level "let" of "x" needs a constant initializer in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const x = yield* c.let("x", i32(1), c.int(32))
        yield* c.let("y", c.add(x, i32(1)), c.int(32))
      }),
    /the top-level "let" of "y" needs a constant initializer in C/,
  )
  const constants = c.program(function*() {
    const x = yield* c.let("x", c.add(i32(1), c.less(i8(2), f64(3))), c.int(32))
    yield* c.let("p", c.add(i32(1), c.address(x)), c.ptr(c.int(32)))
  })
  assert.equal(emitC(constants), "#include <stdint.h>\n\nint32_t x = 1 + (2 < 3.0);\nint32_t* p = 1 + &x;\n")
})
