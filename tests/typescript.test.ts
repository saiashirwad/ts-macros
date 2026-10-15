import assert from "node:assert/strict"
import { test } from "node:test"

import { emitTs, type TS, ts } from "../languages/typescript.ts"
import * as lang from "../src/lang/index.ts"
import { typecheck } from "./stage2.ts"
import { assertType, type Equal } from "./typing.ts"

const emitted: string[] = []

const emits = (program: lang.Program<TS, Parameters<typeof emitTs>[0] extends lang.Program<TS, infer K> ? K : never>, expected: string) => {
  const source = emitTs(program)
  assert.equal(source, expected)
  emitted.push(source)
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

test("emitted TypeScript typechecks", () => {
  assert.equal(typecheck(emitted), "")
})
