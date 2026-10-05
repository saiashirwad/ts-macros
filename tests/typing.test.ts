import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emittedSource, typeOf } from "./typing.ts"

const programs = {
  literals: Program.build(function*() {
    const kept = yield* Decl.const("kept", Expr.number(1))
    typeOf(kept).is<1>().isReadonly()
    const widened = yield* Decl.let("widened", Expr.number(1))
    typeOf(widened).is<number>().isMutable()
    const text = yield* Decl.const("text", Expr.string("hi"))
    typeOf(text).is<"hi">()
    const flag = yield* Decl.let("flag", Expr.boolean(true))
    typeOf(flag).is<boolean>()
    const annotated = yield* Decl.let("annotated", Expr.number(2), Type.number)
    typeOf(annotated).is<number>()
    return { kept, widened, text, flag, annotated }
  }),

  compounds: Program.build(function*() {
    const point = yield* Decl.const("point", Expr.object({ x: Expr.number(1), y: Expr.number(2) }))
    typeOf(point).is<{ x: number; y: number }>()
    const x = yield* Decl.const("x", Expr.prop(point, "x"))
    typeOf(x).is<number>()
    const list = yield* Decl.const("list", Expr.array(Expr.number(1), Expr.number(2)))
    typeOf(list).is<number[]>()
    const first = yield* Decl.const("first", Expr.index(list, Expr.number(0)))
    typeOf(first).is<number | undefined>()
    const mixed = yield* Decl.const("mixed", Expr.array(Expr.string("a"), Expr.number(1)))
    typeOf(mixed).is<(string | number)[]>()
    const nested = yield* Decl.let("nested", Expr.object({ inner: Expr.object({ ok: Expr.boolean(true) }) }))
    typeOf(nested).is<
      { inner: { ok: boolean } }
    >()
    return { x, first, mixed, nested }
  }),

  operators: Program.build(function*() {
    const a = yield* Decl.const("a", Expr.number(3))
    const b = yield* Decl.const("b", Expr.number(4))
    const sum = yield* Decl.const("sum", Expr.binary("+", a, b))
    typeOf(sum).is<number>()
    const label = yield* Decl.const("label", Expr.binary("+", Expr.string("n="), sum))
    typeOf(label).is<string>()
    const bigger = yield* Decl.const("bigger", Expr.binary(">", a, b))
    typeOf(bigger).is<boolean>()
    const either = yield* Decl.const("either", Expr.binary("||", label, sum))
    typeOf(either).is<string | number>()
    const falseAnd = yield* Decl.const("falseAnd", Expr.binary("&&", Expr.boolean(false), sum))
    typeOf(falseAnd).is<false>()
    const trueValue = FFI.Value<true>("trueValue")
    const trueAnd = yield* Decl.const("trueAnd", Expr.binary("&&", trueValue, Expr.string("yes")))
    typeOf(trueAnd).is<"yes">()
    const zeroValue = FFI.Value<0>("zeroValue")
    const zeroOr = yield* Decl.const("zeroOr", Expr.binary("||", zeroValue, Expr.string("fallback")))
    typeOf(zeroOr).is<"fallback">()
    const twoValue = FFI.Value<2>("twoValue")
    const nonzeroOr = yield* Decl.const("nonzeroOr", Expr.binary("||", twoValue, Expr.string("fallback")))
    typeOf(nonzeroOr).is<2>()
    const emptyValue = FFI.Value<"">("emptyValue")
    const emptyAnd = yield* Decl.const("emptyAnd", Expr.binary("&&", emptyValue, sum))
    typeOf(emptyAnd).is<"">()
    const objectValue = FFI.Value<{ ok: true }>("objectValue")
    const objectAnd = yield* Decl.const("objectAnd", Expr.binary("&&", objectValue, Expr.string("object")))
    typeOf(objectAnd).is<"object">()
    const maybeText = FFI.Value<"" | "x">("maybeText")
    const unionAnd = yield* Decl.const("unionAnd", Expr.binary("&&", maybeText, Expr.number(1)))
    typeOf(unionAnd).is<"" | 1>()
    const broadNumber = FFI.Value<number>("broadNumber")
    const numberAnd = yield* Decl.const("numberAnd", Expr.binary("&&", broadNumber, Expr.string("number")))
    typeOf(numberAnd).is<0 | "number">()
    const broadString = FFI.Value<string>("broadString")
    const stringOr = yield* Decl.const("stringOr", Expr.binary("||", broadString, Expr.number(1)))
    typeOf(stringOr).is<string | 1>()
    const nullValue = FFI.Value<null>("nullValue")
    const nullOr = yield* Decl.const("nullOr", Expr.binary("||", nullValue, Expr.number(1)))
    typeOf(nullOr).is<1>()
    const picked = yield* Decl.const("picked", Expr.cond(bigger, a, label))
    typeOf(picked).is<3 | string>()
    const negated = yield* Decl.const("negated", Expr.unary("!", bigger))
    typeOf(negated).is<boolean>()
    const kind = yield* Decl.const("kind", Expr.unary("typeof", sum))
    typeOf(kind).is<
      "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
    >()
    const tpl = yield* Decl.const("tpl", Expr.template(["<", ">"], either))
    typeOf(tpl).is<string>()
    return { picked, negated, kind, tpl }
  }),

  functions: Program.build(function*() {
    const double = yield* Decl.fn("double", {
      params: [Expr.param("n", Type.number)],
      body: function*({ n }) {
        typeOf(n).is<number>().isMutable()
        return Expr.binary("*", n, Expr.number(2))
      },
    })
    typeOf(double).is<(n: number) => number>()

    const classify = yield* Decl.fn("classify", {
      params: [Expr.param("score", Type.number)],
      body: function*({ score }) {
        yield* Stmt.if(Expr.binary(">=", score, Expr.number(90)), function*() {
          yield* Stmt.return(Expr.string("A"))
        })
        return Expr.number(0)
      },
    })
    typeOf(classify).is<(score: number) => "A" | 0>()

    const declared = yield* Decl.fn("declared", {
      params: [Expr.param("text", Type.string), Expr.optional("times", Type.number), Expr.rest("tags", Type.string)],
      returns: Type.string,
      body: function*({ text, times, tags }) {
        typeOf(times).is<number | undefined>()
        typeOf(tags).is<string[]>()
        const savedTimes = yield* Decl.const("savedTimes", times)
        typeOf(savedTimes).is<number | undefined>()
        const savedTags = yield* Decl.const("savedTags", tags)
        typeOf(savedTags).is<string[]>()
        return text
      },
    })
    typeOf(declared).is<(text: string, times?: number | undefined, ...tags: string[]) => string>()

    const doubled = yield* Decl.const("doubled", Expr.call(double, Expr.number(21)))
    typeOf(doubled).is<number>()
    const grade = yield* Decl.const("grade", Expr.call(classify, doubled))
    typeOf(grade).is<"A" | 0>()
    const shout = yield* Decl.const("shout", Expr.call(declared, Expr.string("hey")))
    typeOf(shout).is<string>()
    const arrowFn = yield* Decl.const(
      "arrow",
      Expr.arrow({
        params: [Expr.optional("maybe", Type.string), Expr.rest("values", Type.number)],
        body: function*({ maybe, values }) {
          const savedMaybe = yield* Decl.const("savedMaybe", maybe)
          typeOf(savedMaybe).is<string | undefined>()
          const savedValues = yield* Decl.const("savedValues", values)
          typeOf(savedValues).is<number[]>()
          return Expr.prop(values, "length") as Expr.Expr<number>
        },
      }),
    )
    typeOf(arrowFn).is<(maybe?: string | undefined, ...values: number[]) => number>()
    return { grade, shout, arrow: arrowFn }
  }),

  control: Program.build(function*() {
    const total = yield* Decl.let("total", Expr.number(0))
    typeOf(total).is<number>()
    const words = yield* Decl.const("words", Expr.array(Expr.string("a"), Expr.string("bb")))
    yield* Stmt.forOf("word", words, function*(word) {
      typeOf(word).is<string>().isReadonly()
      yield* Stmt.assign(total, Expr.binary("+", total, Expr.prop(word, "length") as Expr.Expr<number>))
    })
    yield* Stmt.forOf("letter", Expr.string("abc"), function*(letter) {
      typeOf(letter).is<string>()
      yield* Stmt.if(Expr.binary("===", letter, Expr.string("b")), function*() {
        yield* Stmt.break()
      })
    })
    yield* Stmt.while(Expr.binary("<", total, Expr.number(10)), function*() {
      yield* Stmt.assign(total, Expr.binary("+", total, Expr.number(1)))
    })
    return { total }
  }),

  writes: Program.build(function*() {
    const record = yield* Decl.let(
      "record",
      Expr.object({}),
      Type.object({
        name: Type.optional(Type.string),
        explicit: Type.optional(Type.union(Type.string, Type.undefined)),
      }),
    )
    yield* Stmt.assign(Expr.prop(record, "name"), Expr.string("ok"))
    yield* Stmt.assign(Expr.prop(record, "explicit"), FFI.Value<undefined>("undefinedValue"))
    const values = yield* Decl.let("values", Expr.array(Expr.number(0)), Type.array(Type.number))
    yield* Stmt.assign(Expr.index(values, Expr.number(0)), Expr.number(1))
    const tuple = FFI.Value<[number, string]>("tuple")
    const first = Expr.index(tuple, Expr.number(0))
    const second = Expr.index(tuple, Expr.number(1))
    typeOf(first).is<number>()
    typeOf(second).is<string>()
    yield* Stmt.assign(first, Expr.number(1))
    yield* Stmt.assign(second, Expr.string("one"))
    return { record, values, tuple }
  }),

  sugar: Program.build(function*() {
    const count = yield* Decl.let("count", 0)
    typeOf(count).is<number>().isMutable()
    const name = yield* Decl.const("name", "sai")
    typeOf(name).is<"sai">().isReadonly()
    const person = yield* Decl.const("person", { name, age: 30, tags: ["x"] })
    typeOf(person).is<{ name: string; age: number; tags: string[] }>()
    const older = yield* Decl.const("older", Expr.gt(Expr.add(count, 1), 40))
    typeOf(older).is<boolean>()
    yield* Stmt.forOf("tag", Expr.prop(person, "tags") as Expr.Expr<string[]>, function*(tag) {
      typeOf(tag).is<string>()
      yield* Stmt.assign(count, Expr.add(count, 1))
    })
    const greeting = yield* Decl.const("greeting", Expr.call(Expr.prop(name, "toUpperCase") as Expr.Expr<() => string>))
    typeOf(greeting).is<string>()
    return { older, greeting }
  }),

  host: Program.build(function*() {
    const fs = FFI.Import<{ readFileSync: (path: string, encoding: string) => string }>("node:fs", "fs")
    const raw = yield* Decl.const(
      "raw",
      Expr.call(Expr.prop(fs, "readFileSync") as Expr.Expr<(path: string, encoding: string) => string>, "a.txt", "utf8"),
    )
    typeOf(raw).is<string>()
    const parse = FFI.Value<(text: string) => { id: number }>("parse")
    const record = yield* Decl.const("record", Expr.call(parse, raw))
    typeOf(record).is<{ id: number }>()
    const id = yield* Decl.const("id", Expr.prop(record, "id"))
    typeOf(id).is<number>()
    const shown = yield* Decl.const(
      "shown",
      Expr.call(Expr.prop(FFI.Value<JSON>("JSON"), "stringify") as Expr.Expr<(value: unknown) => string>, record),
    )
    typeOf(shown).is<string>()
    return { id, shown }
  }),

  freshness: Program.build(function*() {
    const Letter = Type.union(Type.literal("a"), Type.literal("b"))
    const pick = yield* Decl.fn("pick", {
      params: [Expr.param("letters", Type.array(Letter)), Expr.param("flag", Type.object({ ok: Type.literal(true) }))],
      body: function*({ letters, flag }) {
        const first = yield* Decl.let("first", Expr.index(letters, Expr.number(0)))
        typeOf(first).is<"a" | "b" | undefined>()
        yield* Stmt.forOf("letter", letters, function*(letter) {
          typeOf(letter).is<"a" | "b">()
          yield* Stmt.assign(first, letter)
        })
        const copy = yield* Decl.const("copy", flag)
        typeOf(copy).is<{ ok: true }>()
        return copy
      },
    })
    typeOf(pick).is<(letters: ("a" | "b")[], flag: { ok: true }) => { ok: true }>()

    const one = yield* Decl.const("one", Expr.number(1))
    typeOf(one).is<1>()
    const widened = yield* Decl.let("widened", one)
    typeOf(widened).is<number>()
    const wrapped = yield* Decl.const("wrapped", Expr.object({ value: one }))
    typeOf(wrapped).is<{ value: number }>()
    const pinned = yield* Decl.const("pinned", Expr.number(1), Type.literal(1))
    const kept = yield* Decl.let("kept", pinned)
    typeOf(kept).is<1>()
    const either = yield* Decl.let("either", Expr.cond(Expr.boolean(true), Expr.string("x"), pinned))
    typeOf(either).is<string | 1>()
    return { widened, wrapped, kept, either }
  }),

  generics: Program.build(function*() {
    const T = Type.param("T")
    const identity = yield* Decl.fn("identity", {
      typeParams: [T],
      params: [Expr.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    const numberIdentity = Expr.instantiate(identity, Type.number)
    typeOf(numberIdentity).is<(value: number) => number>()
    const same = yield* Decl.const("same", Expr.call(numberIdentity, Expr.number(7)))
    typeOf(same).is<number>()

    const Pair = yield* Decl.type("Pair", { params: [T], body: Type.object({ first: T, second: T }) })
    const Unwrap = yield* Decl.type("Unwrap", { params: [T], body: Type.conditional(T, Type.promise(Type.infer("U")), Type.param("U"), T) })
    const WrappedString = yield* Decl.type("WrappedString", {
      params: [T],
      body: Type.conditional(Type.tuple(T), Type.tuple(Type.string), Type.literal(true), Type.literal(false)),
    })
    const wrappedString = yield* Decl.const(
      "wrappedString",
      Expr.boolean(false),
      Type.apply(WrappedString, [Type.union(Type.string, Type.number)]),
    )
    typeOf(wrappedString).is<false>()
    const pair = yield* Decl.const(
      "pair",
      Expr.object({ first: Expr.number(1), second: Expr.number(2) }),
      Type.apply(Pair, [Type.number]),
    )
    typeOf(pair).is<{ first: number; second: number }>()
    const unwrapped = yield* Decl.const(
      "unwrapped",
      Expr.prop(pair, "first"),
      Type.apply(Unwrap, [Type.promise(Type.number)]),
    )
    typeOf(unwrapped).is<number>()
    return { same, unwrapped }
  }),
}

const expected = {
  literals: `const kept: 1 = 1;
let widened: number = 1;
const text: "hi" = "hi";
let flag: boolean = true;
let annotated: number = 2;`,

  compounds: `const point: { x: number; y: number } = { x: 1, y: 2 };
const x: number = point.x;
const list: number[] = [1, 2];
const first: number | undefined = list[0];
const mixed: (string | number)[] = ["a", 1];
let nested: { inner: { ok: boolean } } = { inner: { ok: true } };`,

  operators: `const a: 3 = 3;
const b: 4 = 4;
const sum: number = a + b;
const label: string = "n=" + sum;
const bigger: boolean = a > b;
const either: string | number = label || sum;
const falseAnd: false = false && sum;
const trueAnd = trueValue && "yes";
const zeroOr = zeroValue || "fallback";
const nonzeroOr = twoValue || "fallback";
const emptyAnd = emptyValue && sum;
const objectAnd = objectValue && "object";
const unionAnd = maybeText && 1;
const numberAnd = broadNumber && "number";
const stringOr = broadString || 1;
const nullOr = nullValue || 1;
const picked: 3 | string = bigger ? a : label;
const negated: boolean = !bigger;
const kind: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function" = typeof sum;
const tpl: string = \`<\${either}>\`;`,

  functions: `function double(n: number): number {
  return n * 2;
}
function classify(score: number): "A" | 0 {
  if (score >= 90) {
    return "A";
  }
  return 0;
}
function declared(text: string, times?: number, ...tags: string[]): string {
  const savedTimes: number | undefined = times;
  const savedTags: string[] = tags;
  return text;
}
const doubled: number = double(21);
const grade: "A" | 0 = classify(doubled);
const shout: string = declared("hey");
const arrow = (maybe?: string, ...values: number[]) => {
  const savedMaybe = maybe;
  const savedValues = values;
  return values.length;
};`,

  control: `let total: number = 0;
const words: string[] = ["a", "bb"];
for (const word of words) {
  total = total + word.length;
}
for (const letter of "abc") {
  if (letter === "b") {
    break;
  }
}
while (total < 10) {
  total = total + 1;
}`,

  writes: `let record: { name?: string; explicit?: string | undefined } = {};
record.name = "ok";
record.explicit = undefinedValue;
let values: number[] = [0];
values[0] = 1;
tuple[0] = 1;
tuple[1] = "one";`,

  sugar: `let count: number = 0;
const name: "sai" = "sai";
const person: { name: string; age: number; tags: string[] } = { name: name, age: 30, tags: ["x"] };
const older: boolean = count + 1 > 40;
for (const tag of person.tags) {
  count = count + 1;
}
const greeting = name.toUpperCase();`,

  host: `import * as fs from "node:fs";
const raw = fs.readFileSync("a.txt", "utf8");
const record = parse(raw);
const id = record.id;
const shown = JSON.stringify(record);`,

  freshness: `function pick(letters: ("a" | "b")[], flag: { ok: true }): { ok: true } {
  let first: "a" | "b" | undefined = letters[0];
  for (const letter of letters) {
    first = letter;
  }
  const copy: { ok: true } = flag;
  return copy;
}
const one: 1 = 1;
let widened: number = one;
const wrapped: { value: number } = { value: one };
const pinned: 1 = 1;
let kept: 1 = pinned;
let either: string | 1 = true ? "x" : pinned;`,

  generics: `function identity<T>(value: T): T {
  return value;
}
const same: number = identity<number>(7);
type Pair<T> = { first: T; second: T };
type Unwrap<T> = T extends Promise<infer U> ? U : T;
type WrappedString<T> = [T] extends [string] ? true : false;
const wrappedString: WrappedString<string | number> = false;
const pair: Pair<number> = { first: 1, second: 2 };
const unwrapped: Unwrap<Promise<number>> = pair.first;`,
} satisfies { readonly [Name in keyof typeof programs]: string }

for (const [name, program] of Object.entries(programs)) {
  test(`${name}: the inferred types are the ones written out`, () => {
    assert.equal(emittedSource(program), expected[name as keyof typeof expected])
  })
}
