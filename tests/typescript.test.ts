import assert from "node:assert/strict"
import { test } from "node:test"

import { emitTs, type TS, ts } from "../languages/typescript.ts"
import * as lang from "../src/lang/index.ts"
import { typecheck } from "./stage2.ts"
import { assertType, type Equal } from "./typing.ts"

const emitted: string[] = []

const emits = (
  program: lang.Program<TS, Parameters<typeof emitTs>[0] extends lang.Program<TS, infer K> ? K : never>,
  expected: string,
  ...checks: string[]
) => {
  const source = emitTs(program)
  assert.equal(source, expected)
  emitted.push([source, ...checks.map((check, index) => `const check${index}: Equal<${check}> = true;`)].join("\n"))
}

test("object, union, intersection, tuple, and literal types denote TypeScript's types", () => {
  const point = ts.object({
    x: ts.number,
    y: ts.readonly(ts.number),
    label: ts.optional(ts.string),
    id: ts.readonly(ts.optional(ts.literalType("p"))),
  })
  assertType<Equal<lang.Denotes<typeof point>, { x: number; readonly y: number; label?: string; readonly id?: "p" }>>()
  const shape = ts.union(ts.literalType("circle"), ts.literalType(1), ts.literalType(-2n), ts.literalType(true), ts.literalType(null))
  assertType<Equal<lang.Denotes<typeof shape>, "circle" | 1 | -2n | true | null>>()
  const both = ts.intersection(ts.object({ a: ts.number }), ts.union(ts.object({ b: ts.string }), ts.object({ c: ts.boolean })))
  assertType<Equal<lang.Denotes<typeof both>, { a: number } & ({ b: string } | { c: boolean })>>()
  const pair = ts.tuple(ts.string, ts.array(ts.number))
  assertType<Equal<lang.Denotes<typeof pair>, [string, number[]]>>()
  assertType<Equal<lang.Denotes<typeof ts.unknown>, unknown>>()
  assertType<Equal<lang.Denotes<typeof ts.nonPrimitive>, object>>()

  ts.program(function*() {
    yield* ts.let(shape, "s", ts.literal("circle"))
    yield* ts.let(ts.union(ts.string, ts.number), "u", ts.literal(1))
    // @ts-expect-error a boolean is not a string or a number
    yield* ts.let(ts.union(ts.string, ts.number), "v", ts.literal(true))
    yield* ts.let(ts.literalType("on"), "on", ts.literal("on"))
    // @ts-expect-error "off" is not the literal type "on"
    yield* ts.let(ts.literalType("on"), "off", ts.literal("off"))
  })
  assert.throws(() => ts.literalType(NaN), /a literal type must be a finite number, got NaN/)
})

test("tuples have optional and spread elements, and infer can split them", () => {
  const optional = ts.tuple(ts.string, ts.optional(ts.number))
  assertType<Equal<lang.Denotes<typeof optional>, [string, number?]>>()
  const rest = ts.tuple(ts.string, ts.spread(ts.array(ts.number)))
  assertType<Equal<lang.Denotes<typeof rest>, [string, ...number[]]>>()
  const leading = ts.tuple(ts.spread(ts.array(ts.string)), ts.number)
  assertType<Equal<lang.Denotes<typeof leading>, [...string[], number]>>()
  const flat = ts.tuple(ts.literalType(1), ts.spread(ts.tuple(ts.literalType(2), ts.literalType(3))))
  assertType<Equal<lang.Denotes<typeof flat>, [1, 2, 3]>>()
  // @ts-expect-error a required element cannot follow an optional element
  ts.tuple(ts.optional(ts.string), ts.number)
  // @ts-expect-error only an array or tuple type can be spread
  ts.spread(ts.string)
  ts.program(function*() {
    const Concat = yield* ts.alias(
      "Concat",
      [ts.typeParam("A", ts.readonlyArray(ts.unknown)), ts.typeParam("B", ts.readonlyArray(ts.unknown))],
      (A, B) => ts.tuple(ts.spread(A), ts.spread(B)),
    )
    const joined = Concat(ts.tuple(ts.literalType(1)), ts.tuple(ts.literalType(2), ts.optional(ts.literalType(3))))
    assertType<Equal<lang.Denotes<typeof joined>, [1, 2, 3?]>>()
    const Rotate = yield* ts.alias(
      "Rotate",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["H", ["R", ts.array(ts.unknown)]], (H, R) => ts.tuple(H, ts.spread(R)), (H, R) => ts.tuple(ts.spread(R), H), T),
    )
    type TsRotate<T> = T extends [infer H, ...infer R] ? [...R, H] : T
    const rotated = Rotate(ts.tuple(ts.literalType(1), ts.literalType(2), ts.literalType(3)))
    assertType<Equal<lang.Denotes<typeof rotated>, TsRotate<[1, 2, 3]>>>()
    const empty = Rotate(ts.tuple())
    assertType<Equal<lang.Denotes<typeof empty>, TsRotate<[]>>>()
  })
  const program = ts.program(function*() {
    yield* ts.alias(
      "Rotate",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["H", ["R", ts.array(ts.unknown)]], (H, R) => ts.tuple(H, ts.spread(R)), (H, R) => ts.tuple(ts.spread(R), H), T),
    )
    yield* ts.fn(
      "f",
      [ts.param("t", ts.tuple(ts.union(ts.string, ts.number), ts.optional(ts.union(ts.string, ts.number)), ts.spread(ts.array(ts.boolean))))],
      ts.void,
      function*() {},
    )
  })
  emits(
    program,
    `type Rotate<T> = T extends [infer H, ...infer R extends unknown[]] ? [...R, H] : T;
function f(t: [string | number, (string | number)?, ...boolean[]]): void {}`,
    "Rotate<[1, 2, 3]>, [2, 3, 1]",
  )
})

test("template literal types check their interpolations", () => {
  const id = ts.template("user-", ts.number, "-", ts.union(ts.literalType("a"), ts.literalType("b")))
  assertType<Equal<lang.Denotes<typeof id>, `user-${number}-a` | `user-${number}-b`>>()
  const plain = ts.template("x")
  assertType<Equal<lang.Denotes<typeof plain>, "x">>()
  ts.program(function*() {
    yield* ts.let(id, "ok", ts.literal("user-1-a"))
    // @ts-expect-error "user-x-a" does not match `user-${number}-a`
    yield* ts.let(id, "bad", ts.literal("user-x-a"))
  })
  // @ts-expect-error an object type cannot be interpolated into a template literal type
  ts.template("a", ts.object({}))
  const prefix: string = "a"
  // @ts-expect-error a template's text must be a literal string
  ts.template(prefix, ts.number)
})

test("composite types emit with the parentheses TypeScript needs", () => {
  const program = ts.program(function*() {
    yield* ts.fn(
      "f",
      [
        ts.param("a", ts.array(ts.union(ts.string, ts.number))),
        ts.param(
          "b",
          ts.intersection(ts.union(ts.object({ a: ts.number }), ts.object({ b: ts.string })), ts.object({ "c-d": ts.optional(ts.boolean) })),
        ),
        ts.param("c", ts.union(ts.intersection(ts.object({}), ts.nonPrimitive), ts.tuple(), ts.tuple(ts.literalType("x"), ts.literalType(-1)))),
        ts.param("d", ts.template("a`b${", ts.string, "\\")),
        ts.param("e", ts.object({ readonly: ts.readonly(ts.optional(ts.array(ts.array(ts.bigint)))) })),
      ],
      ts.void,
      function*() {},
    )
    yield* ts.let(ts.template("a`b${", ts.string, "\\"), "t", ts.literal("a`b${x\\"))
  })
  emits(
    program,
    `function f(a: (string | number)[], b: ({ a: number } | { b: string }) & { "c-d"?: boolean }, c: {} & object | [] | ["x", -1], d: \`a\\\`b\\\${\${string}\\\\\`, e: { readonly readonly?: bigint[][] }): void {}
let t: \`a\\\`b\\\${\${string}\\\\\` = "a\`b\${x\\\\";`,
  )
  assertType<
    Equal<
      typeof program,
      lang.Program<
        TS,
        | "function"
        | "array-type"
        | "union-type"
        | "intersection-type"
        | "object-type"
        | "primitive-type"
        | "tuple-type"
        | "literal-type"
        | "template-type"
        | "let"
        | "literal"
      >
    >
  >()
})

test("keyof and indexed access types follow TypeScript", () => {
  const user = ts.object({ name: ts.string, age: ts.optional(ts.number) })
  const keys = ts.keyof(user)
  assertType<Equal<lang.Denotes<typeof keys>, "name" | "age">>()
  const age = ts.index(user, ts.literalType("age"))
  assertType<Equal<lang.Denotes<typeof age>, number | undefined>>()
  const values = ts.index(user, keys)
  assertType<Equal<lang.Denotes<typeof values>, string | number | undefined>>()
  const element = ts.index(ts.array(ts.string), ts.number)
  assertType<Equal<lang.Denotes<typeof element>, string>>()
  // @ts-expect-error "email" is not a key of the object type
  ts.index(user, ts.literalType("email"))
})

test("type aliases are generic in their parameters and checked when applied", () => {
  ts.program(function*() {
    const Box = yield* ts.alias("Box", [ts.typeParam("T")], (T) => ts.object({ value: T, all: ts.array(T) }))
    const box = Box(ts.number)
    assertType<Equal<lang.Denotes<typeof box>, { value: number; all: number[] }>>()
    const Keyed = yield* ts.alias(
      "Keyed",
      [ts.typeParam("K", ts.string), ts.typeParam("V")],
      (K, V) => ts.object({ key: K, value: ts.union(V, ts.null) }),
    )
    const keyed = Keyed(ts.literalType("id"), Box(ts.string))
    assertType<Equal<lang.Denotes<typeof keyed>, { key: "id"; value: { value: string; all: string[] } | null }>>()
    // @ts-expect-error a number does not satisfy the constraint string
    Keyed(ts.number, ts.string)
    // @ts-expect-error Box takes one type argument
    Box(ts.number, ts.string)
    const Get = yield* ts.alias("Get", [ts.typeParam("T"), ts.typeParam("K")], (T, K) => ts.index(T, ts.intersection(K, ts.keyof(T))))
    const got = Get(ts.object({ a: ts.literalType(1), b: ts.string }), ts.literalType("a"))
    assertType<Equal<lang.Denotes<typeof got>, 1>>()
    // @ts-expect-error K is not known to be a key of T
    yield* ts.alias("Unchecked", [ts.typeParam("T"), ts.typeParam("K")], (T, K) => ts.index(T, K))
    const Id = yield* ts.alias("Id", [ts.typeParam("P", ts.string)], (P) => ts.template(P, "-", ts.number))
    const id = Id(ts.union(ts.literalType("a"), ts.literalType("b")))
    assertType<Equal<lang.Denotes<typeof id>, `a-${number}` | `b-${number}`>>()
    // @ts-expect-error an unconstrained parameter cannot be interpolated into a template literal type
    yield* ts.alias("Loose", [ts.typeParam("P")], (P) => ts.template(P))
    const Point = yield* ts.alias("Point", [], () => ts.object({ x: ts.number, y: ts.number }))
    assertType<Equal<lang.Denotes<typeof Point>, { x: number; y: number }>>()
  })
  assert.throws(
    () =>
      ts.program(function*() {
        // @ts-expect-error the body takes two parameters, but the alias declares one
        yield* ts.alias("Arity", [ts.typeParam("T")], (T, U) => ts.union(T, U))
      }),
    /the body of type alias "Arity" takes 2 arguments for 1 type parameters/,
  )
})

test("type aliases emit with their parameters, constraints, and applications", () => {
  const program = ts.program(function*() {
    const Box = yield* ts.alias("Box", [ts.typeParam("T", ts.union(ts.string, ts.number))], (T) => ts.object({ value: T }))
    const Pair = yield* ts.alias("Pair", [ts.typeParam("A", ts.string), ts.typeParam("A")], (A, B) => ts.tuple(Box(A), B))
    const Keys = yield* ts.alias("Keys", [ts.typeParam("T")], (T) => ts.array(ts.keyof(T)))
    const Point = yield* ts.alias("Point", [], () => ts.object({ x: ts.number }))
    yield* ts.fn("f", [ts.param("p", Pair(ts.literalType("x"), Keys(Box(ts.number)))), ts.param("q", Point)], ts.void, function*() {})
  })
  emits(
    program,
    `type Box<T extends string | number> = { value: T };
type Pair<A extends string, A_2> = [Box<A>, A_2];
type Keys<T> = (keyof T)[];
type Point = { x: number };
function f(p: Pair<"x", Keys<Box<number>>>, q: Point): void {}`,
  )
})

test("conditional types distribute over a checked type parameter, as TypeScript does", () => {
  const fixed = ts.conditional(ts.literalType("a"), ts.string, ts.literalType(1), ts.literalType(2))
  assertType<Equal<lang.Denotes<typeof fixed>, 1>>()
  ts.program(function*() {
    const NotString = yield* ts.alias("NotString", [ts.typeParam("T")], (T) => ts.conditional(T, ts.string, ts.never, T))
    const mixed = ts.union(ts.literalType("a"), ts.literalType(1), ts.boolean)
    const kept = NotString(mixed)
    assertType<Equal<lang.Denotes<typeof kept>, Exclude<"a" | 1 | boolean, string>>>()
    const ToArray = yield* ts.alias("ToArray", [ts.typeParam("T")], (T) => ts.conditional(T, ts.unknown, ts.array(T), ts.never))
    const arrays = ToArray(ts.union(ts.literalType("a"), ts.literalType(1)))
    assertType<Equal<lang.Denotes<typeof arrays>, "a"[] | 1[]>>()
    const Whole = yield* ts.alias(
      "Whole",
      [ts.typeParam("T")],
      (T) => ts.conditional(ts.tuple(T), ts.tuple(ts.string), ts.literalType(1), ts.literalType(2)),
    )
    const whole = Whole(ts.union(ts.literalType("a"), ts.literalType(1)))
    assertType<Equal<lang.Denotes<typeof whole>, 2>>()
    const IsString = yield* ts.alias(
      "IsString",
      [ts.typeParam("T")],
      (T) => ts.conditional(T, ts.string, ts.literalType(true), ts.literalType(false)),
    )
    const ofNever = IsString(ts.never)
    assertType<Equal<lang.Denotes<typeof ofNever>, never>>()
    const ofAny = IsString(ts.any)
    assertType<Equal<lang.Denotes<typeof ofAny>, boolean>>()
    const wholeNever = Whole(ts.never)
    assertType<Equal<lang.Denotes<typeof wholeNever>, 1>>()
    const Nested = yield* ts.alias("Nested", [ts.typeParam("T")], (T) => ts.array(NotString(ts.union(T, ts.literalType("x")))))
    const nested = Nested(ts.union(ts.literalType(1), ts.literalType("y")))
    assertType<Equal<lang.Denotes<typeof nested>, 1[]>>()
  })
})

test("infer binds type variables from TypeScript's own inference", () => {
  ts.program(function*() {
    const ElementOf = yield* ts.alias("ElementOf", [ts.typeParam("T")], (T) => ts.infer(T, ["E"], (E) => ts.array(E), (E) => E, ts.never))
    const element = ElementOf(ts.union(ts.array(ts.string), ts.number))
    assertType<Equal<lang.Denotes<typeof element>, string>>()
    yield* ts.let(ElementOf(ts.array(ts.literalType("x"))), "x", ts.literal("x"))
    // @ts-expect-error "y" is not the element type "x"
    yield* ts.let(ElementOf(ts.array(ts.literalType("x"))), "y", ts.literal("y"))
    const Swap = yield* ts.alias("Swap", [ts.typeParam("T")], (T) => ts.infer(T, ["A", "B"], (A, B) => ts.tuple(A, B), (A, B) => ts.tuple(B, A), T))
    const swapped = Swap(ts.union(ts.tuple(ts.literalType(1), ts.string), ts.literalType("other")))
    assertType<Equal<lang.Denotes<typeof swapped>, [string, 1] | "other">>()
    const Both = ts.infer(ts.tuple(ts.literalType(1), ts.literalType(2)), ["U"], (U) => ts.tuple(U, U), (U) => U, ts.never)
    assertType<Equal<lang.Denotes<typeof Both>, 1 | 2>>()
    const Inner = yield* ts.alias(
      "Inner",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["U"], (U) => ts.tuple(U), (U) => ts.conditional(U, ts.string, ts.tuple(U), ts.literalType(0)), ts.literalType(0)),
    )
    const inner = Inner(ts.tuple(ts.union(ts.literalType("a"), ts.literalType(1))))
    assertType<Equal<lang.Denotes<typeof inner>, ["a"] | 0>>()
    const Field = yield* ts.alias(
      "Field",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["V"], (V) => ts.object({ value: V }), (V) => ts.keyof(V), ts.never),
    )
    const field = Field(ts.object({ value: ts.object({ a: ts.number, b: ts.string }), other: ts.boolean }))
    assertType<Equal<lang.Denotes<typeof field>, "a" | "b">>()
    const Quoted = yield* ts.alias(
      "Quoted",
      [ts.typeParam("T")],
      (T) => ts.infer(T, [["S", ts.string]], (S) => ts.tuple(S), (S) => ts.template("<", S, ">"), ts.literalType(0)),
    )
    type TsQuoted<T> = T extends [infer S extends string] ? `<${S}>` : 0
    const quoted = Quoted(ts.union(ts.tuple(ts.literalType("a")), ts.tuple(ts.literalType(1))))
    assertType<Equal<lang.Denotes<typeof quoted>, TsQuoted<["a"] | [1]>>>()
    // @ts-expect-error E is not known to be a string, so it cannot be interpolated
    ts.infer(ts.array(ts.string), ["E"], (E) => ts.array(E), (E) => ts.template(E), ts.never)
  })
  ts.program(function*() {
    const Reused = yield* ts.alias("Reused", [ts.typeParam("U")], (U) => ts.infer(U, ["U"], (V) => ts.array(V), (V) => ts.tuple(V, U), U))
    const reused = Reused(ts.array(ts.string))
    assertType<Equal<lang.Denotes<typeof reused>, [string, string[]]>>()
    yield* ts.alias(
      "Siblings",
      [ts.typeParam("T")],
      (T) => ts.union(ts.infer(T, ["U"], (U) => ts.array(U), (U) => U, T), ts.infer(T, ["U"], (U) => ts.tuple(U), (U) => U, T)),
    )
  })
  assert.throws(
    () =>
      ts.program(function*() {
        yield* ts.alias(
          "Shadowed",
          [ts.typeParam("T")],
          (T) => ts.infer(T, ["U"], (U) => ts.array(U), (outer) => ts.infer(outer, ["U"], (U) => ts.array(U), () => outer, ts.never), ts.never),
        )
      }),
    /type variable "U" is used where another type variable of the same name shadows it; rename one of them/,
  )
})

test("conditional and infer types emit as TypeScript conditionals", () => {
  const program = ts.program(function*() {
    const ElementOf = yield* ts.alias("ElementOf", [ts.typeParam("T")], (T) => ts.infer(T, ["E"], (E) => ts.array(E), (E) => E, ts.never))
    const NotString = yield* ts.alias("NotString", [ts.typeParam("T")], (T) => ts.conditional(T, ts.string, ts.never, T))
    yield* ts.alias(
      "Quoted",
      [ts.typeParam("T")],
      (T) => ts.infer(T, [["S", ts.string]], (S) => S, (S) => ts.template("<", S, ">"), ts.literalType(0)),
    )
    const Chained = yield* ts.alias(
      "Chained",
      [ts.typeParam("T")],
      (T) => ts.array(ts.conditional(ts.union(T, ts.null), ts.conditional(T, ts.string, ts.number, ts.boolean), ElementOf(T), NotString(T))),
    )
    yield* ts.let(ElementOf(ts.array(ts.literalType("x"))), "x", ts.literal("x"))
    const chained = Chained(ts.literalType("a"))
    assertType<Equal<lang.Denotes<typeof chained>, never[]>>()
  })
  emits(
    program,
    `type ElementOf<T> = T extends (infer E)[] ? E : never;
type NotString<T> = T extends string ? never : T;
type Quoted<T> = T extends (infer S extends string) ? \`<\${S}>\` : 0;
type Chained<T> = (T | null extends (T extends string ? number : boolean) ? ElementOf<T> : NotString<T>)[];
let x: ElementOf<"x"[]> = "x";`,
    "ElementOf<string[] | number>, string",
    "NotString<\"a\" | 1 | boolean>, 1 | boolean",
    "Chained<\"a\">, never[]",
    "Quoted<\"a\" | 1>, \"<a>\" | 0",
  )
})

test("mapped types bind their key, preserve or change modifiers, and remap keys", () => {
  type Source = { a: number; readonly b?: string; c?: boolean | undefined }
  const source = ts.object({ a: ts.number, b: ts.readonly(ts.optional(ts.string)), c: ts.optional(ts.union(ts.boolean, ts.undefined)) })
  ts.program(function*() {
    const Same = yield* ts.alias("Same", [ts.typeParam("T")], (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K)))
    const same = Same(source)
    assertType<Equal<lang.Denotes<typeof same>, { [K in keyof Source]: Source[K] }>>()
    const Optional = yield* ts.alias("Optional", [ts.typeParam("T")], (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { optional: "+" }))
    const optional = Optional(source)
    assertType<Equal<lang.Denotes<typeof optional>, Partial<Source>>>()
    const Needed = yield* ts.alias(
      "Needed",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { optional: "-", readonly: "-" }),
    )
    const needed = Needed(source)
    assertType<Equal<lang.Denotes<typeof needed>, { -readonly [K in keyof Source]-?: Source[K] }>>()
    const Frozen = yield* ts.alias(
      "Frozen",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.array(ts.index(T, K)), { readonly: "+" }),
    )
    const frozen = Frozen(ts.union(source, ts.tuple(ts.string, ts.number)))
    type TsFrozen<T> = { readonly [K in keyof T]: T[K][] }
    assertType<Equal<lang.Denotes<typeof frozen>, TsFrozen<Source | [string, number]>>>()
    const common = ts.mapped("K", ts.keyof(ts.union(source, ts.tuple(ts.string))), (K) => ts.tuple(K))
    assertType<Equal<lang.Denotes<typeof common>, { [K in keyof (Source | [string])]: [K] }>>()
    const Box = yield* ts.alias("Box", [ts.typeParam("T")], (T) => ts.object({ value: T }))
    const Boxed = yield* ts.alias("Boxed", [ts.typeParam("T")], (T) => ts.mapped("K", ts.keyof(T), (K) => Box(ts.index(T, K))))
    const boxed = Boxed(ts.tuple(ts.string, ts.literalType(1)))
    assertType<Equal<lang.Denotes<typeof boxed>, [{ value: string }, { value: 1 }]>>()
    const Strings = yield* ts.alias(
      "Strings",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { as: (K) => ts.conditional(ts.index(T, K), ts.string, K, ts.never) }),
    )
    const strings = Strings(ts.object({ a: ts.string, b: ts.number, c: ts.literalType("c") }))
    assertType<Equal<lang.Denotes<typeof strings>, { a: string; c: "c" }>>()
    // @ts-expect-error the key "b" is not a key of { a: number }
    ts.mapped("K", ts.union(ts.literalType("a"), ts.literalType("b")), (K) => ts.index(ts.object({ a: ts.number }), K))
  })
  const getters = ts.mapped("K", ts.union(ts.literalType("x"), ts.literalType("y")), (K) => ts.template("get_", K), {
    as: (K) => ts.template("get_", K),
  })
  assertType<Equal<lang.Denotes<typeof getters>, { get_x: "get_x"; get_y: "get_y" }>>()
  const grid = ts.mapped(
    "Row",
    ts.union(ts.literalType("a"), ts.literalType("b")),
    (Row) => ts.mapped("Col", ts.union(ts.literalType(1), ts.literalType(2)), (Col) => ts.template(Row, Col)),
  )
  assertType<Equal<lang.Denotes<typeof grid>, { a: { 1: "a1"; 2: "a2" }; b: { 1: "b1"; 2: "b2" } }>>()
  assert.throws(
    () =>
      ts.program(function*() {
        yield* ts.alias("Nested", [], () => ts.mapped("K", ts.literalType("a"), (outer) => ts.mapped("K", ts.literalType("b"), () => outer)))
      }),
    /type variable "K" is used where another type variable of the same name shadows it; rename one of them/,
  )
})

test("mapped types emit with their modifiers and key remapping", () => {
  const program = ts.program(function*() {
    yield* ts.alias("Same", [ts.typeParam("T")], (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K)))
    yield* ts.alias("Needed", [ts.typeParam("T")], (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { optional: "-", readonly: "-" }))
    yield* ts.alias(
      "Frozen",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.array(ts.index(T, K)), { readonly: "+", optional: "+" }),
    )
    yield* ts.alias(
      "Strings",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { as: (K) => ts.conditional(ts.index(T, K), ts.string, K, ts.never) }),
    )
    yield* ts.alias(
      "Getters",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { as: (K) => ts.template("get_", ts.intersection(K, ts.string)) }),
    )
  })
  emits(
    program,
    `type Same<T> = { [K in keyof T]: T[K] };
type Needed<T> = { -readonly [K in keyof T]-?: T[K] };
type Frozen<T> = { readonly [K in keyof T]?: T[K][] };
type Strings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };
type Getters<T> = { [K in keyof T as \`get_\${K & string}\`]: T[K] };`,
    "Same<{ a: 1; readonly b?: 2 }>, { a: 1; readonly b?: 2 }",
    "Needed<{ readonly a?: 1 | undefined }>, { a: 1 | undefined }",
    "Frozen<[1]>, readonly [1[]?]",
    "Strings<{ a: string; b: number }>, { a: string }",
    "Getters<{ a: 1; 2: 3 }>, { get_a: 1 }",
  )
  const getters = ts.program(function*() {
    const Getters = yield* ts.alias(
      "Getters",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { as: (K) => ts.template("get_", ts.intersection(K, ts.string)) }),
    )
    const applied = Getters(ts.object({ a: ts.literalType(1), 2: ts.literalType(3) }))
    assertType<Equal<lang.Denotes<typeof applied>, { get_a: 1 }>>()
    const Needed = yield* ts.alias(
      "Needed",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.index(T, K), { optional: "-", readonly: "-" }),
    )
    const needed = Needed(ts.object({ a: ts.readonly(ts.optional(ts.union(ts.literalType(1), ts.undefined))) }))
    assertType<Equal<lang.Denotes<typeof needed>, { a: 1 | undefined }>>()
  })
  assert.ok(getters)
})

const as = <T>(): T => undefined as T

test("function types denote TypeScript function types, and function values and parameters are callable through them", () => {
  const binary = ts.functionType([ts.number, ts.string], ts.boolean)
  assertType<Equal<lang.Denotes<typeof binary>, (a: number, b: string) => boolean>>()
  const variadic = ts.functionType([ts.number], ts.void, ts.array(ts.string))
  assertType<Equal<lang.Denotes<typeof variadic>, (a: number, ...rest: string[]) => void>>()
  // @ts-expect-error a rest parameter must be an array type
  ts.functionType([], ts.void, ts.string)
  ts.program(function*() {
    const Returns = yield* ts.alias(
      "Returns",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["R"], (R) => ts.functionType([], R, ts.array(ts.any)), (R) => R, ts.never),
    )
    const returned = Returns(ts.union(binary, ts.functionType([], ts.literalType("x")), ts.string))
    assertType<Equal<lang.Denotes<typeof returned>, ReturnType<((a: number, b: string) => boolean) | (() => "x")>>>()
    const Params = yield* ts.alias(
      "Params",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["P"], (P) => ts.functionType([], ts.unknown, P), (P) => P, ts.never),
    )
    const params = Params(variadic)
    assertType<Equal<lang.Denotes<typeof params>, Parameters<(a: number, ...rest: string[]) => void>>>()
    const double = yield* ts.fn("double", [ts.param("x", ts.number)], ts.number, function*(x) {
      yield* ts.return(ts.add(x, x))
    })
    const unary = ts.functionType([ts.number], ts.number)
    const f = yield* ts.let(unary, "f", double)
    // @ts-expect-error double takes a number, not a string
    yield* ts.let(ts.functionType([ts.string], ts.number), "g", double)
    yield* ts.fn("twice", [ts.param("h", unary), ts.param("x", ts.number)], ts.number, function*(h, x) {
      yield* ts.return(ts.call(h, ts.call(h, x)))
    })
    const result = ts.call(f, ts.literal(1))
    assertType<Equal<lang.Denotes<typeof result>, number>>()
    // @ts-expect-error f takes a number
    ts.call(f, ts.literal("1"))
  })
})

test("function types emit with positional parameters and the parentheses TypeScript needs", () => {
  const program = ts.program(function*() {
    const Returns = yield* ts.alias(
      "Returns",
      [ts.typeParam("T")],
      (T) => ts.infer(T, ["R"], (R) => ts.functionType([], R, ts.array(ts.any)), (R) => R, ts.never),
    )
    const unary = ts.functionType([ts.number], ts.number)
    const double = yield* ts.fn("double", [ts.param("x", ts.number)], ts.number, function*(x) {
      yield* ts.return(ts.add(x, x))
    })
    const twice = yield* ts.fn("twice", [ts.param("h", unary), ts.param("x", ts.number)], Returns(unary), function*(h, x) {
      yield* ts.return(ts.call(h, ts.call(h, x)))
    })
    yield* ts.let(ts.union(ts.functionType([], ts.void, ts.array(ts.string)), ts.null), "maybe", ts.literal(null))
    yield* ts.fn("compose", [ts.param("f", ts.functionType([unary], unary))], ts.void, function*() {})
    yield* ts.let(ts.number, "four", ts.call(twice, double, ts.literal(1)))
  })
  emits(
    program,
    `type Returns<T> = T extends (...rest: any[]) => infer R ? R : never;
function double(x: number): number {
  return x + x;
}
function twice(h: (arg0: number) => number, x: number): Returns<(arg0: number) => number> {
  return h(h(x));
}
let maybe: ((...rest: string[]) => void) | null = null;
function compose(f: (arg0: (arg0: number) => number) => (arg0: number) => number): void {}
let four: number = twice(double, 1);`,
    "Returns<() => 1>, 1",
  )
})

test("typeof, nullish, and array guards narrow as TypeScript narrows", () => {
  type Mixed = string | number | boolean[] | null | undefined | { a: 1 }
  const mixed = ts.union(ts.string, ts.number, ts.array(ts.boolean), ts.null, ts.undefined, ts.object({ a: ts.literalType(1) }))
  type Overlapping = string | readonly string[] | number[]
  const overlapping = ts.union(ts.string, ts.array(ts.number), ts.readonlyArray(ts.string))
  type Literals = "a" | 1 | `x${number}` | 2n | symbol | true
  const literals = ts.union(ts.literalType("a"), ts.literalType(1), ts.template("x", ts.number), ts.literalType(2n), ts.symbol, ts.literalType(true))
  type Voids = string | void | undefined
  const voids = ts.union(ts.string, ts.void, ts.undefined)
  type Callables = string | ((a: number) => void) | { a: 1 } | object
  const callables = ts.union(ts.string, ts.functionType([ts.number], ts.void), ts.object({ a: ts.literalType(1) }), ts.nonPrimitive)
  ts.program(function*() {
    yield* ts.fn(
      "probe",
      [
        ts.param("m", mixed),
        ts.param("u", ts.unknown),
        ts.param("e", ts.object({})),
        ts.param("o", overlapping),
        ts.param("l", literals),
        ts.param("v", voids),
        ts.param("c", callables),
      ],
      ts.void,
      function*(m, u, e, o, l, v, c) {
        const M = as<Mixed>()
        const U = as<unknown>()
        const E = as<{}>()
        const O = as<Overlapping>()
        const L = as<Literals>()
        const V = as<Voids>()
        const C = as<Callables>()
        yield* ts.if(ts.typeOf(m, "object"), function*(x) {
          if (typeof M === "object") assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        }, function*(x) {
          if (typeof M !== "object") assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        })
        yield* ts.if(ts.typeOf(m, "undefined"), function*(x) {
          if (typeof M === "undefined") assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        }, function*(x) {
          if (typeof M !== "undefined") assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        })
        yield* ts.if(ts.notNull(m), function*(x) {
          if (M != null) assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        }, function*(x) {
          if (M == null) assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        })
        yield* ts.if(ts.isArray(m), function*(x) {
          if (Array.isArray(M)) assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        }, function*(x) {
          if (!Array.isArray(M)) assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        })
        yield* ts.if(ts.typeOf(u, "object"), function*(x) {
          if (typeof U === "object") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (typeof U !== "object") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.typeOf(u, "undefined"), function*(x) {
          if (typeof U === "undefined") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (typeof U !== "undefined") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.typeOf(u, "string"), function*(x) {
          if (typeof U === "string") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (typeof U !== "string") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.notNull(u), function*(x) {
          if (U != null) assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (U == null) assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.isArray(u), function*(x) {
          if (Array.isArray(U)) assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (!Array.isArray(U)) assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.typeOf(e, "object"), function*(x) {
          if (typeof E === "object") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        }, function*(x) {
          if (typeof E !== "object") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        })
        yield* ts.if(ts.typeOf(e, "string"), function*(x) {
          if (typeof E === "string") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        }, function*(x) {
          if (typeof E !== "string") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        })
        yield* ts.if(ts.isArray(e), function*(x) {
          if (Array.isArray(E)) assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        }, function*(x) {
          if (!Array.isArray(E)) assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        })
        yield* ts.if(ts.isArray(o), function*(x) {
          if (Array.isArray(O)) assertType<Equal<lang.Denotes<typeof x>, typeof O>>()
        }, function*(x) {
          if (!Array.isArray(O)) assertType<Equal<lang.Denotes<typeof x>, typeof O>>()
        })
        yield* ts.if(ts.typeOf(l, "string"), function*(x) {
          if (typeof L === "string") assertType<Equal<lang.Denotes<typeof x>, typeof L>>()
        }, function*(x) {
          if (typeof L !== "string") assertType<Equal<lang.Denotes<typeof x>, typeof L>>()
        })
        yield* ts.if(ts.typeOf(l, "boolean"), function*(x) {
          if (typeof L === "boolean") assertType<Equal<lang.Denotes<typeof x>, typeof L>>()
        }, function*(x) {
          if (typeof L !== "boolean") assertType<Equal<lang.Denotes<typeof x>, typeof L>>()
        })
        yield* ts.if(ts.isNull(v), function*(x) {
          if (V == null) assertType<Equal<lang.Denotes<typeof x>, typeof V>>()
        }, function*(x) {
          if (V != null) assertType<Equal<lang.Denotes<typeof x>, typeof V>>()
        })
        yield* ts.if(ts.typeOf(c, "function"), function*(x) {
          if (typeof C === "function") assertType<Equal<lang.Denotes<typeof x>, typeof C>>()
        }, function*(x) {
          if (typeof C !== "function") assertType<Equal<lang.Denotes<typeof x>, typeof C>>()
        })
        yield* ts.if(ts.typeOf(c, "object"), function*(x) {
          if (typeof C === "object") assertType<Equal<lang.Denotes<typeof x>, typeof C>>()
        }, function*(x) {
          if (typeof C !== "object") assertType<Equal<lang.Denotes<typeof x>, typeof C>>()
        })
        yield* ts.if(ts.typeOf(u, "function"), function*(x) {
          if (typeof U === "function") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        }, function*(x) {
          if (typeof U !== "function") assertType<Equal<lang.Denotes<typeof x>, typeof U>>()
        })
        yield* ts.if(ts.typeOf(e, "function"), function*(x) {
          if (typeof E === "function") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        }, function*(x) {
          if (typeof E !== "function") assertType<Equal<lang.Denotes<typeof x>, typeof E>>()
        })
        yield* ts.if(ts.not(ts.typeOf(m, "number")), function*(x) {
          if (!(typeof M === "number")) assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        }, function*(x) {
          if (typeof M === "number") assertType<Equal<lang.Denotes<typeof x>, typeof M>>()
        })
        yield* ts.if(ts.notNull(m), function*(x) {
          yield* ts.if(ts.typeOf(x, "object"), function*(y) {
            if (M != null && typeof M === "object") assertType<Equal<lang.Denotes<typeof y>, typeof M>>()
          })
        })
      },
    )
  })
})

test("a function with a type predicate narrows the argument it is called with", () => {
  type Point = { x: number; y: number }
  const point = ts.object({ x: ts.number, y: ts.number })
  const isPoint = (value: unknown): value is Point => typeof value === "object"
  ts.program(function*() {
    const guard = yield* ts.fn("isPoint", [ts.param("value", ts.unknown)], ts.predicate(0, point), function*(value) {
      yield* ts.return(ts.typeOf(value, "object"))
    })
    yield* ts.fn("use", [ts.param("p", ts.union(point, ts.string, ts.null))], ts.void, function*(p) {
      const P = as<Point | string | null>()
      yield* ts.if(ts.call(guard, p), function*(x) {
        if (isPoint(P)) assertType<Equal<lang.Denotes<typeof x>, typeof P>>()
      }, function*(x) {
        if (!isPoint(P)) assertType<Equal<lang.Denotes<typeof x>, typeof P>>()
      })
      const flag = yield* ts.let(ts.boolean, "flag", ts.call(guard, p))
      yield* ts.if(flag, function*(...refs) {
        assertType<Equal<typeof refs, []>>()
      })
    })
    // @ts-expect-error a type predicate's type must be assignable to the parameter's type
    yield* ts.fn("isText", [ts.param("value", ts.number)], ts.predicate(0, ts.string), function*() {
      yield* ts.return(ts.literal(false))
    })
    // @ts-expect-error a type predicate function returns a boolean
    yield* ts.fn("isWrong", [ts.param("value", ts.unknown)], ts.predicate(0, point), function*() {
      yield* ts.return(ts.literal(1))
    })
  })
  assert.throws(
    // @ts-expect-error the type predicate names a parameter the function does not have
    () => ts.fn("missing", [], ts.predicate(0, point), function*() {}),
    /the type predicate of "missing" names parameter 0, which it does not have/,
  )
})

test("a narrowed reference is still assigned against its declared type, and is rejected where TypeScript would not narrow it", () => {
  ts.program(function*() {
    yield* ts.fn("f", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      yield* ts.if(ts.typeOf(x, "string"), function*(text) {
        yield* ts.let(ts.string, "copy", text)
        // @ts-expect-error outside the branch, x is a string or a number
        yield* ts.let(ts.string, "wide", x)
        yield* ts.assign(text, ts.literal(1))
        // @ts-expect-error a boolean is not assignable to the declared string | number
        yield* ts.assign(text, ts.literal(true))
      })
    })
  })
  const rejects = (body: () => Generator<lang.Stmt<TS, any, any>, void, unknown>, message: RegExp) => assert.throws(() => ts.program(body), message)
  rejects(function*() {
    yield* ts.fn("f", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      yield* ts.if(ts.typeOf(x, "string"), function*(text) {
        yield* ts.assign(x, ts.literal(1))
        yield* ts.let(ts.string, "stale", text)
      })
    })
  }, /a narrowed reference to "x" is used after "x" may have been assigned/)
  rejects(function*() {
    yield* ts.fn("f", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      yield* ts.if(ts.typeOf(x, "string"), function*(text) {
        yield* ts.while(ts.literal(true), function*() {
          yield* ts.let(ts.string, "looped", text)
          yield* ts.assign(x, ts.literal(1))
        })
      })
    })
  }, /a narrowed reference to "x" is used after "x" may have been assigned/)
  rejects(function*() {
    yield* ts.fn("f", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      yield* ts.if(ts.typeOf(x, "string"), function*(text) {
        yield* ts.fn("inner", [], ts.string, function*() {
          yield* ts.return(text)
        })
      })
    })
  }, /a narrowed reference to "x" is used in a function nested in the branch that narrowed it/)
  rejects(function*() {
    yield* ts.fn("f", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      let escaped: lang.Ref<TS, string, string | number> | undefined
      yield* ts.if(ts.typeOf(x, "string"), function*(text) {
        escaped = text
      })
      yield* ts.let(ts.string, "escaped", escaped!)
    })
  }, /a narrowed reference to "x" is used outside the branch that narrowed it/)
  ts.program(function*() {
    yield* ts.fn("g", [ts.param("x", ts.union(ts.string, ts.number))], ts.void, function*(x) {
      yield* ts.while(ts.literal(true), function*() {
        yield* ts.if(ts.typeOf(x, "string"), function*(text) {
          yield* ts.let(ts.string, "fresh", text)
        })
        yield* ts.assign(x, ts.literal(1))
      })
    })
  })
})

test("guards emit as TypeScript narrowing tests", () => {
  const program = ts.program(function*() {
    const point = ts.object({ x: ts.number })
    const isPoint = yield* ts.fn("isPoint", [ts.param("value", ts.unknown)], ts.predicate(0, point), function*(value) {
      yield* ts.if(ts.typeOf(value, "object"), function*(object) {
        yield* ts.if(ts.notNull(object), function*() {
          yield* ts.return(ts.literal(true))
        })
      })
      yield* ts.return(ts.literal(false))
    })
    yield* ts.fn(
      "describe",
      [ts.param("input", ts.union(ts.string, ts.array(ts.number), point, ts.undefined))],
      ts.string,
      function*(input) {
        yield* ts.if(ts.isNull(input), function*() {
          yield* ts.return(ts.literal("none"))
        }, function*(present) {
          yield* ts.if(ts.not(ts.typeOf(present, "string")), function*(other) {
            yield* ts.if(ts.isArray(other), function*(list) {
              yield* ts.let(ts.array(ts.number), "list", list)
            }, function*(single) {
              yield* ts.let(point, "single", single)
            })
            yield* ts.if(ts.call(isPoint, other), function*(found) {
              yield* ts.let(point, "found", found)
            })
            yield* ts.return(ts.literal("other"))
          }, function*(text) {
            yield* ts.return(text)
          })
        })
        yield* ts.return(ts.literal("unreachable"))
      },
    )
  })
  emits(
    program,
    `function isPoint(value: unknown): value is { x: number } {
  if (typeof value === "object") {
    if (value != null) {
      return true;
    }
  }
  return false;
}
function describe(input: string | number[] | { x: number } | undefined): string {
  if (input == null) {
    return "none";
  } else {
    if (!(typeof input === "string")) {
      if (Array.isArray(input)) {
        let list: number[] = input;
      } else {
        let single: { x: number } = input;
      }
      if (isPoint(input)) {
        let found: { x: number } = input;
      }
      return "other";
    } else {
      return input;
    }
  }
  return "unreachable";
}`,
  )
})

test("emitted TypeScript typechecks", () => {
  assert.equal(
    typecheck(
      emitted.map((source) => `type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;\n${source}`),
    ),
    "",
  )
})
