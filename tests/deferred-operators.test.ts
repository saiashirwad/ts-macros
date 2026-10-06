import { test } from "node:test"

import type {
  CondDenote,
  IndexDenote,
  Inferred,
  KeyOfDenote,
  LogicalDenote,
  MappedDenote,
  Op,
  Substitute,
  TmplDenote,
  Variable,
} from "../src/types/core.ts"
import type { TypeParam } from "../src/types/nodes.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

type T = Variable<"T">
type U = Variable<"U">
type Apply<Body, Arg> = Substitute<Body, [TypeParam<"T">], [Arg]>

test("deferred operators retain phase-specific readiness rules", () => {
  assertType<Equal<IndexDenote<{ a: 1 }, "missing">, Op<"index", [{ a: 1 }, "missing"]>>>()
  assertType<Equal<Apply<IndexDenote<T, "missing">, { a: 1 }>, never>>()
  assertType<Equal<Apply<IndexDenote<T, "a" | "missing">, { a: 1 }>, 1>>()
  assertType<Equal<Apply<IndexDenote<T, U>, { a: 1 }>, Op<"index", [{ a: 1 }, U]>>>()
  assertType<Equal<KeyOfDenote<T>, Op<"keyof", [T]>>>()
  assertType<Equal<Apply<KeyOfDenote<T>, { a: 1 }>, "a">>()
  assertType<Equal<MappedDenote<{ a: 1 }, U, "K">, Op<"mapped", [{ a: 1 }, U, "K"]>>>()
  assertType<Equal<MappedDenote<{ a: 1 }, Variable<"K">, "K">, { a: "a" }>>()
  assertType<Equal<Apply<MappedDenote<T, U, "K">, { a: 1 }>, { a: U }>>()
  assertType<Equal<Apply<TmplDenote<["id-", ""], [T]>, 2>, "id-2">>()
  assertType<Equal<Apply<TmplDenote<["", "/", ""], [T, U]>, 2>, Op<"tmpl", [["", "/", ""], [2, U]]>>>()
  assertType<Equal<Apply<LogicalDenote<"and", T, U>, false>, Op<"and", [false, U]>>>()
  assertType<Equal<Apply<LogicalDenote<"or", T, U>, true>, Op<"or", [true, U]>>>()
  assertType<Equal<Apply<LogicalDenote<"and", T, "yes">, false | 1>, false | "yes">>()
  assertType<Equal<Apply<LogicalDenote<"or", T, "yes">, false | 1>, 1 | "yes">>()
})

test("conditional readiness preserves distribution, inference, any and never", () => {
  assertType<Equal<CondDenote<1, number, U, false>, U>>()
  assertType<Equal<CondDenote<1, T, true, false>, Op<"cond", [1, T, true, false]>>>()
  assertType<Equal<CondDenote<string | number, string, true, false>, false>>()
  assertType<Equal<Apply<CondDenote<T, string, true, false>, string | number>, boolean>>()
  assertType<Equal<Apply<CondDenote<[T], [string], true, false>, string | number>, false>>()
  assertType<Equal<Apply<CondDenote<T, string, true, false>, never>, never>>()
  assertType<Equal<Apply<CondDenote<T, string, true, false>, any>, boolean>>()
  assertType<Equal<Apply<CondDenote<T, [unknown], true, false>, any>, true>>()
  assertType<Equal<Apply<CondDenote<T, (...args: any[]) => any, true, false>, any>, true>>()
  assertType<Equal<Apply<CondDenote<T, Inferred<"I">[], Variable<"I">, false>, number[]>, number>>()
  assertType<Equal<Apply<CondDenote<T, Inferred<"I">[], Variable<"I">, false>, any>, unknown>>()
  assertType<Equal<Apply<CondDenote<[T], [U], true, false>, 1>, Op<"cond", [[1], [U], true, false]>>>()
  assertType<Equal<LogicalDenote<"and", never, 1>, never>>()
  assertType<Equal<LogicalDenote<"or", any, 1>, any>>()
  assertType<Equal<KeyOfDenote<never>, string | number | symbol>>()
  assertType<Equal<TmplDenote<["", ""], [never]>, never>>()
})
