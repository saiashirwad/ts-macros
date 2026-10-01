import { Decl, Expr, FFI, Program } from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

export const cases = {
  propertyOverlap: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ x: number | string }>("left"), FFI.Value<{ x: number | boolean }>("right")))
    }),
  },
  propertyOverlapNotEqual: {
    ambient: "declare const left: { x: number | string }; declare const right: { x: number | boolean };",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.neq(FFI.Value<{ x: number | string }>("left"), FFI.Value<{ x: number | boolean }>("right")))
    }),
  },
  disjointProperty: {
    ambient: "declare const left: { x: number }; declare const right: { x: string };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects non-overlapping property types
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ x: number }>("left"), FFI.Value<{ x: string }>("right")))
    }),
  },
  unrelatedProperties: {
    ambient: "declare const left: { a: number }; declare const right: { b: string };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects unrelated required properties
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ a: number }>("left"), FFI.Value<{ b: string }>("right")))
    }),
  },
  missingRequiredProperties: {
    ambient: "declare const left: { x: number; a: number }; declare const right: { x: number; b: string };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error a common field is not enough when both sides lack required fields
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ x: number; a: number }>("left"), FFI.Value<{ x: number; b: string }>("right")))
    }),
  },
  optionalDisjoint: {
    ambient: "declare const left: { x?: number }; declare const right: { x?: string };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error exact optional property comparison excludes implicit undefined
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ x?: number }>("left"), FFI.Value<{ x?: string }>("right")))
    }),
  },
  optionalMissing: {
    ambient: "declare const left: { a: number }; declare const right: { b?: string };",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ a: number }>("left"), FFI.Value<{ b?: string }>("right")))
    }),
  },
  optionalSubset: {
    ambient: "declare const left: { a: number }; declare const right: { a?: number; b?: string };",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ a: number }>("left"), FFI.Value<{ a?: number; b?: string }>("right")))
    }),
  },
  nestedOverlap: {
    ambient: "declare const left: { x: { y: number | string } }; declare const right: { x: { y: number | boolean } };",
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.eq(FFI.Value<{ x: { y: number | string } }>("left"), FFI.Value<{ x: { y: number | boolean } }>("right")),
      )
    }),
  },
  nestedDisjoint: {
    ambient: "declare const left: { x: { y: number } }; declare const right: { x: { y: string } };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects recursively disjoint fields
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ x: { y: number } }>("left"), FFI.Value<{ x: { y: string } }>("right")))
    }),
  },
  arrayOverlap: {
    ambient: "declare const left: (number | string)[]; declare const right: (number | boolean)[];",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<(number | string)[]>("left"), FFI.Value<(number | boolean)[]>("right")))
    }),
  },
  arrayDisjoint: {
    ambient: "declare const left: number[]; declare const right: string[];",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects disjoint array element types
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<number[]>("left"), FFI.Value<string[]>("right")))
    }),
  },
  tupleOverlap: {
    ambient: "declare const left: [1, string]; declare const right: [number, \"a\"];",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<[1, string]>("left"), FFI.Value<[number, "a"]>("right")))
    }),
  },
  tupleDisjoint: {
    ambient: "declare const left: [number, string]; declare const right: [string, number];",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tuple positions must overlap individually
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<[number, string]>("left"), FFI.Value<[string, number]>("right")))
    }),
  },
  functionOverlap: {
    ambient: "declare const left: (x: number | string) => number | string; declare const right: (x: number | boolean) => number | boolean;",
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.eq(FFI.Value<(x: number | string) => number | string>("left"), FFI.Value<(x: number | boolean) => number | boolean>("right")),
      )
    }),
  },
  functionDisjoint: {
    ambient: "declare const left: (x: number) => number; declare const right: (x: string) => string;",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects disjoint function types
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<(x: number) => number>("left"), FFI.Value<(x: string) => string>("right")))
    }),
  },
  discriminantDisjoint: {
    ambient: "declare const left: { kind: \"a\"; v: number }; declare const right: { kind: \"b\"; v: number };",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error shared non-discriminant fields cannot hide disjoint tags
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<{ kind: "a"; v: number }>("left"), FFI.Value<{ kind: "b"; v: number }>("right")))
    }),
  },
  primitiveDisjoint: {
    ambient: "declare const left: number; declare const right: string;",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects unrelated primitives
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<number>("left"), FFI.Value<string>("right")))
    }),
  },
  primitiveUnion: {
    ambient: "declare const left: number | string; declare const right: number | boolean;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<number | string>("left"), FFI.Value<number | boolean>("right")))
    }),
  },
  literalDisjoint: {
    ambient: "declare const left: 1; declare const right: 2;",
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error tsc rejects disjoint literal types
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<1>("left"), FFI.Value<2>("right")))
    }),
  },
  nullishComparison: {
    ambient: "declare const left: number; declare const right: null;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.eq(FFI.Value<number>("left"), FFI.Value<null>("right")))
    }),
  },
} satisfies Record<string, ExactCase>
