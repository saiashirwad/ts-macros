import * as T from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

export const cases = {
  propertyOverlap: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<{ x: number | string }>("left"), T.hostValue<{ x: number | boolean }>("right")))
    }),
  },
  propertyOverlapNotEqual: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: T.build(function*() {
      return yield* T.const("actual", T.neq(T.hostValue<{ x: number | string }>("left"), T.hostValue<{ x: number | boolean }>("right")))
    }),
  },
  disjointProperty: {
    ambient: "declare const left: { x: number }; declare const right: { x: string };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects non-overlapping property types
      return yield* T.const("actual", T.eq(T.hostValue<{ x: number }>("left"), T.hostValue<{ x: string }>("right")))
    }),
  },
  unrelatedProperties: {
    ambient: "declare const left: { a: number }; declare const right: { b: string };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects unrelated required properties
      return yield* T.const("actual", T.eq(T.hostValue<{ a: number }>("left"), T.hostValue<{ b: string }>("right")))
    }),
  },
  missingRequiredProperties: {
    ambient: "declare const left: { x: number; a: number }; declare const right: { x: number; b: string };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error a common field is not enough when both sides lack required fields
      return yield* T.const("actual", T.eq(T.hostValue<{ x: number; a: number }>("left"), T.hostValue<{ x: number; b: string }>("right")))
    }),
  },
  optionalDisjoint: {
    ambient: "declare const left: { x?: number }; declare const right: { x?: string };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error exact optional property comparison excludes implicit undefined
      return yield* T.const("actual", T.eq(T.hostValue<{ x?: number }>("left"), T.hostValue<{ x?: string }>("right")))
    }),
  },
  optionalMissing: {
    ambient: "declare const left: { a: number }; declare const right: { b?: string };",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<{ a: number }>("left"), T.hostValue<{ b?: string }>("right")))
    }),
  },
  optionalSubset: {
    ambient: "declare const left: { a: number }; declare const right: { a?: number; b?: string };",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<{ a: number }>("left"), T.hostValue<{ a?: number; b?: string }>("right")))
    }),
  },
  nestedOverlap: {
    ambient: "declare const left: { x: { y: number | string } }; declare const right: { x: { y: number | boolean } };",
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.eq(T.hostValue<{ x: { y: number | string } }>("left"), T.hostValue<{ x: { y: number | boolean } }>("right")),
      )
    }),
  },
  nestedDisjoint: {
    ambient: "declare const left: { x: { y: number } }; declare const right: { x: { y: string } };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects recursively disjoint fields
      return yield* T.const("actual", T.eq(T.hostValue<{ x: { y: number } }>("left"), T.hostValue<{ x: { y: string } }>("right")))
    }),
  },
  arrayOverlap: {
    ambient: "declare const left: (number | string)[]; declare const right: (number | boolean)[];",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<(number | string)[]>("left"), T.hostValue<(number | boolean)[]>("right")))
    }),
  },
  arrayDisjoint: {
    ambient: "declare const left: number[]; declare const right: string[];",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects disjoint array element types
      return yield* T.const("actual", T.eq(T.hostValue<number[]>("left"), T.hostValue<string[]>("right")))
    }),
  },
  tupleOverlap: {
    ambient: "declare const left: [1, string]; declare const right: [number, \"a\"];",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<[1, string]>("left"), T.hostValue<[number, "a"]>("right")))
    }),
  },
  tupleDisjoint: {
    ambient: "declare const left: [number, string]; declare const right: [string, number];",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tuple positions must overlap individually
      return yield* T.const("actual", T.eq(T.hostValue<[number, string]>("left"), T.hostValue<[string, number]>("right")))
    }),
  },
  functionOverlap: {
    ambient: "declare const left: (x: number | string) => number | string; declare const right: (x: number | boolean) => number | boolean;",
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.eq(T.hostValue<(x: number | string) => number | string>("left"), T.hostValue<(x: number | boolean) => number | boolean>("right")),
      )
    }),
  },
  functionDisjoint: {
    ambient: "declare const left: (x: number) => number; declare const right: (x: string) => string;",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects disjoint function types
      return yield* T.const("actual", T.eq(T.hostValue<(x: number) => number>("left"), T.hostValue<(x: string) => string>("right")))
    }),
  },
  discriminantDisjoint: {
    ambient: "declare const left: { kind: \"a\"; v: number }; declare const right: { kind: \"b\"; v: number };",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error shared non-discriminant fields cannot hide disjoint tags
      return yield* T.const("actual", T.eq(T.hostValue<{ kind: "a"; v: number }>("left"), T.hostValue<{ kind: "b"; v: number }>("right")))
    }),
  },
  primitiveDisjoint: {
    ambient: "declare const left: number; declare const right: string;",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects unrelated primitives
      return yield* T.const("actual", T.eq(T.hostValue<number>("left"), T.hostValue<string>("right")))
    }),
  },
  primitiveUnion: {
    ambient: "declare const left: number | string; declare const right: number | boolean;",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<number | string>("left"), T.hostValue<number | boolean>("right")))
    }),
  },
  literalDisjoint: {
    ambient: "declare const left: 1; declare const right: 2;",
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error tsc rejects disjoint literal types
      return yield* T.const("actual", T.eq(T.hostValue<1>("left"), T.hostValue<2>("right")))
    }),
  },
  nullishComparison: {
    ambient: "declare const left: number; declare const right: null;",
    program: T.build(function*() {
      return yield* T.const("actual", T.eq(T.hostValue<number>("left"), T.hostValue<null>("right")))
    }),
  },
} satisfies Record<string, ExactCase>
