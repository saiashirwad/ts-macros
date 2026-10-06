import * as $ from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

export const cases = {
  propertyOverlap: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<{ x: number | string }>("left"), $.hostValue<{ x: number | boolean }>("right")))
    }),
  },
  propertyOverlapNotEqual: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: $.build(function*() {
      return yield* $.const("actual", $.neq($.hostValue<{ x: number | string }>("left"), $.hostValue<{ x: number | boolean }>("right")))
    }),
  },
  disjointProperty: {
    ambient: "declare const left: { x: number }; declare const right: { x: string };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects non-overlapping property types
      return yield* $.const("actual", $.eq($.hostValue<{ x: number }>("left"), $.hostValue<{ x: string }>("right")))
    }),
  },
  unrelatedProperties: {
    ambient: "declare const left: { a: number }; declare const right: { b: string };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects unrelated required properties
      return yield* $.const("actual", $.eq($.hostValue<{ a: number }>("left"), $.hostValue<{ b: string }>("right")))
    }),
  },
  missingRequiredProperties: {
    ambient: "declare const left: { x: number; a: number }; declare const right: { x: number; b: string };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error a common field is not enough when both sides lack required fields
      return yield* $.const("actual", $.eq($.hostValue<{ x: number; a: number }>("left"), $.hostValue<{ x: number; b: string }>("right")))
    }),
  },
  optionalDisjoint: {
    ambient: "declare const left: { x?: number }; declare const right: { x?: string };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error exact optional property comparison excludes implicit undefined
      return yield* $.const("actual", $.eq($.hostValue<{ x?: number }>("left"), $.hostValue<{ x?: string }>("right")))
    }),
  },
  optionalMissing: {
    ambient: "declare const left: { a: number }; declare const right: { b?: string };",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<{ a: number }>("left"), $.hostValue<{ b?: string }>("right")))
    }),
  },
  optionalSubset: {
    ambient: "declare const left: { a: number }; declare const right: { a?: number; b?: string };",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<{ a: number }>("left"), $.hostValue<{ a?: number; b?: string }>("right")))
    }),
  },
  nestedOverlap: {
    ambient: "declare const left: { x: { y: number | string } }; declare const right: { x: { y: number | boolean } };",
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.eq($.hostValue<{ x: { y: number | string } }>("left"), $.hostValue<{ x: { y: number | boolean } }>("right")),
      )
    }),
  },
  nestedDisjoint: {
    ambient: "declare const left: { x: { y: number } }; declare const right: { x: { y: string } };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects recursively disjoint fields
      return yield* $.const("actual", $.eq($.hostValue<{ x: { y: number } }>("left"), $.hostValue<{ x: { y: string } }>("right")))
    }),
  },
  arrayOverlap: {
    ambient: "declare const left: (number | string)[]; declare const right: (number | boolean)[];",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<(number | string)[]>("left"), $.hostValue<(number | boolean)[]>("right")))
    }),
  },
  arrayDisjoint: {
    ambient: "declare const left: number[]; declare const right: string[];",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects disjoint array element types
      return yield* $.const("actual", $.eq($.hostValue<number[]>("left"), $.hostValue<string[]>("right")))
    }),
  },
  tupleOverlap: {
    ambient: "declare const left: [1, string]; declare const right: [number, \"a\"];",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<[1, string]>("left"), $.hostValue<[number, "a"]>("right")))
    }),
  },
  tupleDisjoint: {
    ambient: "declare const left: [number, string]; declare const right: [string, number];",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tuple positions must overlap individually
      return yield* $.const("actual", $.eq($.hostValue<[number, string]>("left"), $.hostValue<[string, number]>("right")))
    }),
  },
  functionOverlap: {
    ambient: "declare const left: (x: number | string) => number | string; declare const right: (x: number | boolean) => number | boolean;",
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.eq($.hostValue<(x: number | string) => number | string>("left"), $.hostValue<(x: number | boolean) => number | boolean>("right")),
      )
    }),
  },
  functionDisjoint: {
    ambient: "declare const left: (x: number) => number; declare const right: (x: string) => string;",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects disjoint function types
      return yield* $.const("actual", $.eq($.hostValue<(x: number) => number>("left"), $.hostValue<(x: string) => string>("right")))
    }),
  },
  discriminantDisjoint: {
    ambient: "declare const left: { kind: \"a\"; v: number }; declare const right: { kind: \"b\"; v: number };",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error shared non-discriminant fields cannot hide disjoint tags
      return yield* $.const("actual", $.eq($.hostValue<{ kind: "a"; v: number }>("left"), $.hostValue<{ kind: "b"; v: number }>("right")))
    }),
  },
  primitiveDisjoint: {
    ambient: "declare const left: number; declare const right: string;",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects unrelated primitives
      return yield* $.const("actual", $.eq($.hostValue<number>("left"), $.hostValue<string>("right")))
    }),
  },
  primitiveUnion: {
    ambient: "declare const left: number | string; declare const right: number | boolean;",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<number | string>("left"), $.hostValue<number | boolean>("right")))
    }),
  },
  literalDisjoint: {
    ambient: "declare const left: 1; declare const right: 2;",
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error tsc rejects disjoint literal types
      return yield* $.const("actual", $.eq($.hostValue<1>("left"), $.hostValue<2>("right")))
    }),
  },
  nullishComparison: {
    ambient: "declare const left: number; declare const right: null;",
    program: $.build(function*() {
      return yield* $.const("actual", $.eq($.hostValue<number>("left"), $.hostValue<null>("right")))
    }),
  },
} satisfies Record<string, ExactCase>
