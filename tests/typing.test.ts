import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { emittedSource, typeOf } from "./typing.ts"

const programs = {
  literals: T.build(function*() {
    const kept = yield* T.const("kept", T.numberLiteral(1))
    typeOf(kept).is<1>().isReadonly()
    const widened = yield* T.let("widened", T.numberLiteral(1))
    typeOf(widened).is<number>().isMutable()
    const text = yield* T.const("text", T.stringLiteral("hi"))
    typeOf(text).is<"hi">()
    const flag = yield* T.let("flag", T.booleanLiteral(true))
    typeOf(flag).is<boolean>()
    const annotated = yield* T.let("annotated", T.numberLiteral(2), T.Number)
    typeOf(annotated).is<number>()
    return { kept, widened, text, flag, annotated }
  }),

  compounds: T.build(function*() {
    const point = yield* T.const("point", T.objectLiteral({ x: T.numberLiteral(1), y: T.numberLiteral(2) }))
    typeOf(point).is<{ x: number; y: number }>()
    const x = yield* T.const("x", T.prop(point, "x"))
    typeOf(x).is<number>()
    const list = yield* T.const("list", T.arrayLiteral(T.numberLiteral(1), T.numberLiteral(2)))
    typeOf(list).is<number[]>()
    const first = yield* T.const("first", T.index(list, T.numberLiteral(0)))
    typeOf(first).is<number | undefined>()
    const mixed = yield* T.const("mixed", T.arrayLiteral(T.stringLiteral("a"), T.numberLiteral(1)))
    typeOf(mixed).is<(string | number)[]>()
    const nested = yield* T.let("nested", T.objectLiteral({ inner: T.objectLiteral({ ok: T.booleanLiteral(true) }) }))
    typeOf(nested).is<
      { inner: { ok: boolean } }
    >()
    return { x, first, mixed, nested }
  }),

  operators: T.build(function*() {
    const a = yield* T.const("a", T.numberLiteral(3))
    const b = yield* T.const("b", T.numberLiteral(4))
    const sum = yield* T.const("sum", T.binary("+", a, b))
    typeOf(sum).is<number>()
    const label = yield* T.const("label", T.binary("+", T.stringLiteral("n="), sum))
    typeOf(label).is<string>()
    const bigger = yield* T.const("bigger", T.binary(">", a, b))
    typeOf(bigger).is<boolean>()
    const either = yield* T.const("either", T.binary("||", label, sum))
    typeOf(either).is<string | number>()
    const falseAnd = yield* T.const("falseAnd", T.binary("&&", T.booleanLiteral(false), sum))
    typeOf(falseAnd).is<false>()
    const trueValue = T.hostValue<true>("trueValue")
    const trueAnd = yield* T.const("trueAnd", T.binary("&&", trueValue, T.stringLiteral("yes")))
    typeOf(trueAnd).is<"yes">()
    const zeroValue = T.hostValue<0>("zeroValue")
    const zeroOr = yield* T.const("zeroOr", T.binary("||", zeroValue, T.stringLiteral("fallback")))
    typeOf(zeroOr).is<"fallback">()
    const twoValue = T.hostValue<2>("twoValue")
    const nonzeroOr = yield* T.const("nonzeroOr", T.binary("||", twoValue, T.stringLiteral("fallback")))
    typeOf(nonzeroOr).is<2>()
    const emptyValue = T.hostValue<"">("emptyValue")
    const emptyAnd = yield* T.const("emptyAnd", T.binary("&&", emptyValue, sum))
    typeOf(emptyAnd).is<"">()
    const objectValue = T.hostValue<{ ok: true }>("objectValue")
    const objectAnd = yield* T.const("objectAnd", T.binary("&&", objectValue, T.stringLiteral("object")))
    typeOf(objectAnd).is<"object">()
    const maybeText = T.hostValue<"" | "x">("maybeText")
    const unionAnd = yield* T.const("unionAnd", T.binary("&&", maybeText, T.numberLiteral(1)))
    typeOf(unionAnd).is<"" | 1>()
    const broadNumber = T.hostValue<number>("broadNumber")
    const numberAnd = yield* T.const("numberAnd", T.binary("&&", broadNumber, T.stringLiteral("number")))
    typeOf(numberAnd).is<0 | "number">()
    const broadString = T.hostValue<string>("broadString")
    const stringOr = yield* T.const("stringOr", T.binary("||", broadString, T.numberLiteral(1)))
    typeOf(stringOr).is<string | 1>()
    const nullValue = T.hostValue<null>("nullValue")
    const nullOr = yield* T.const("nullOr", T.binary("||", nullValue, T.numberLiteral(1)))
    typeOf(nullOr).is<1>()
    const picked = yield* T.const("picked", T.cond(bigger, a, label))
    typeOf(picked).is<3 | string>()
    const negated = yield* T.const("negated", T.unary("!", bigger))
    typeOf(negated).is<boolean>()
    const kind = yield* T.const("kind", T.unary("typeof", sum))
    const tpl = yield* T.const("tpl", T.template(["<", ">"], either))
    typeOf(tpl).is<string>()
    return { picked, negated, kind, tpl }
  }),

  functions: T.build(function*() {
    const double = yield* T.fn("double", {
      params: [T.param("n", T.Number)],
      body: function*({ n }) {
        typeOf(n).is<number>().isMutable()
        return T.binary("*", n, T.numberLiteral(2))
      },
    })
    typeOf(double).is<(n: number) => number>()

    const classify = yield* T.fn("classify", {
      params: [T.param("score", T.Number)],
      body: function*({ score }) {
        yield* T.if(T.binary(">=", score, T.numberLiteral(90)), function*() {
          yield* T.return(T.stringLiteral("A"))
        })
        return T.numberLiteral(0)
      },
    })
    typeOf(classify).is<(score: number) => "A" | 0>()

    const declared = yield* T.fn("declared", {
      params: [T.param("text", T.String), T.optional("times", T.Number), T.rest("tags", T.String)],
      returns: T.String,
      body: function*({ text, times, tags }) {
        typeOf(times).is<number | undefined>()
        typeOf(tags).is<string[]>()
        const savedTimes = yield* T.const("savedTimes", times)
        typeOf(savedTimes).is<number | undefined>()
        const savedTags = yield* T.const("savedTags", tags)
        typeOf(savedTags).is<string[]>()
        return text
      },
    })
    typeOf(declared).is<(text: string, times?: number | undefined, ...tags: string[]) => string>()

    const doubled = yield* T.const("doubled", T.call(double, T.numberLiteral(21)))
    typeOf(doubled).is<number>()
    const grade = yield* T.const("grade", T.call(classify, doubled))
    typeOf(grade).is<"A" | 0>()
    const shout = yield* T.const("shout", T.call(declared, T.stringLiteral("hey")))
    typeOf(shout).is<string>()
    const arrowFn = yield* T.const(
      "arrow",
      T.arrow({
        params: [T.optional("maybe", T.String), T.rest("values", T.Number)],
        body: function*({ maybe, values }) {
          const savedMaybe = yield* T.const("savedMaybe", maybe)
          typeOf(savedMaybe).is<string | undefined>()
          const savedValues = yield* T.const("savedValues", values)
          typeOf(savedValues).is<number[]>()
          return T.prop(values, "length") as T.Expr<number>
        },
      }),
    )
    typeOf(arrowFn).is<(maybe?: string | undefined, ...values: number[]) => number>()
    return { grade, shout, arrow: arrowFn }
  }),

  control: T.build(function*() {
    const total = yield* T.let("total", T.numberLiteral(0))
    typeOf(total).is<number>()
    const words = yield* T.const("words", T.arrayLiteral(T.stringLiteral("a"), T.stringLiteral("bb")))
    yield* T.forOf("word", words, function*(word) {
      typeOf(word).is<string>().isReadonly()
      yield* T.assign(total, T.binary("+", total, T.prop(word, "length") as T.Expr<number>))
    })
    yield* T.forOf("letter", T.stringLiteral("abc"), function*(letter) {
      typeOf(letter).is<string>()
      yield* T.if(T.binary("===", letter, T.stringLiteral("b")), function*() {
        yield* T.break()
      })
    })
    yield* T.while(T.binary("<", total, T.numberLiteral(10)), function*() {
      yield* T.assign(total, T.binary("+", total, T.numberLiteral(1)))
    })
    return { total }
  }),

  writes: T.build(function*() {
    const record = yield* T.let(
      "record",
      T.objectLiteral({}),
      T.Object({
        name: T.Optional(T.String),
        explicit: T.Optional(T.Union(T.String, T.Undefined)),
      }),
    )
    yield* T.assign(T.prop(record, "name"), T.stringLiteral("ok"))
    yield* T.assign(T.prop(record, "explicit"), T.hostValue<undefined>("undefinedValue"))
    const values = yield* T.let("values", T.arrayLiteral(T.numberLiteral(0)), T.Array(T.Number))
    yield* T.assign(T.index(values, T.numberLiteral(0)), T.numberLiteral(1))
    const tuple = T.hostValue<[number, string]>("tuple")
    const first = T.index(tuple, T.numberLiteral(0))
    const second = T.index(tuple, T.numberLiteral(1))
    typeOf(first).is<number>()
    typeOf(second).is<string>()
    yield* T.assign(first, T.numberLiteral(1))
    yield* T.assign(second, T.stringLiteral("one"))
    return { record, values, tuple }
  }),

  sugar: T.build(function*() {
    const count = yield* T.let("count", 0)
    typeOf(count).is<number>().isMutable()
    const name = yield* T.const("name", "sai")
    typeOf(name).is<"sai">().isReadonly()
    const person = yield* T.const("person", { name, age: 30, tags: ["x"] })
    typeOf(person).is<{ name: string; age: number; tags: string[] }>()
    const older = yield* T.const("older", T.gt(T.add(count, 1), 40))
    typeOf(older).is<boolean>()
    yield* T.forOf("tag", T.prop(person, "tags") as T.Expr<string[]>, function*(tag) {
      typeOf(tag).is<string>()
      yield* T.assign(count, T.add(count, 1))
    })
    const greeting = yield* T.const("greeting", T.call(T.prop(name, "toUpperCase") as T.Expr<() => string>))
    typeOf(greeting).is<string>()
    return { older, greeting }
  }),

  host: T.build(function*() {
    const fs = T.hostImport<{ readFileSync: (path: string, encoding: string) => string }>("node:fs", "fs")
    const raw = yield* T.const(
      "raw",
      T.call(T.prop(fs, "readFileSync") as T.Expr<(path: string, encoding: string) => string>, "a.txt", "utf8"),
    )
    typeOf(raw).is<string>()
    const parse = T.hostValue<(text: string) => { id: number }>("parse")
    const record = yield* T.const("record", T.call(parse, raw))
    typeOf(record).is<{ id: number }>()
    const id = yield* T.const("id", T.prop(record, "id"))
    typeOf(id).is<number>()
    const shown = yield* T.const(
      "shown",
      T.call(T.prop(T.hostValue<JSON>("JSON"), "stringify") as T.Expr<(value: unknown) => string>, record),
    )
    typeOf(shown).is<string>()
    return { id, shown }
  }),

  freshness: T.build(function*() {
    const Letter = T.Union(T.Literal("a"), T.Literal("b"))
    const pick = yield* T.fn("pick", {
      params: [T.param("letters", T.Array(Letter)), T.param("flag", T.Object({ ok: T.Literal(true) }))],
      body: function*({ letters, flag }) {
        const first = yield* T.let("first", T.index(letters, T.numberLiteral(0)))
        typeOf(first).is<"a" | "b" | undefined>()
        yield* T.forOf("letter", letters, function*(letter) {
          typeOf(letter).is<"a" | "b">()
          yield* T.assign(first, letter)
        })
        const copy = yield* T.const("copy", flag)
        typeOf(copy).is<{ ok: true }>()
        return copy
      },
    })
    typeOf(pick).is<(letters: ("a" | "b")[], flag: { ok: true }) => { ok: true }>()

    const one = yield* T.const("one", T.numberLiteral(1))
    typeOf(one).is<1>()
    const widened = yield* T.let("widened", one)
    typeOf(widened).is<number>()
    const wrapped = yield* T.const("wrapped", T.objectLiteral({ value: one }))
    typeOf(wrapped).is<{ value: number }>()
    const pinned = yield* T.const("pinned", T.numberLiteral(1), T.Literal(1))
    const kept = yield* T.let("kept", pinned)
    typeOf(kept).is<1>()
    const either = yield* T.let("either", T.cond(T.booleanLiteral(true), T.stringLiteral("x"), pinned))
    typeOf(either).is<string | 1>()
    return { widened, wrapped, kept, either }
  }),

  generics: T.build(function*() {
    const TParam = T.TypeParam("T")
    const identity = yield* T.fn("identity", {
      typeParams: [TParam],
      params: [T.param("value", TParam)],
      returns: TParam,
      body: function*({ value }) {
        return value
      },
    })
    const numberIdentity = T.instantiate(identity, T.Number)
    typeOf(numberIdentity).is<(value: number) => number>()
    const same = yield* T.const("same", T.call(numberIdentity, T.numberLiteral(7)))
    typeOf(same).is<number>()

    const Pair = yield* T.type("Pair", { params: [TParam], body: T.Object({ first: TParam, second: TParam }) })
    const Unwrap = yield* T.type("Unwrap", { params: [TParam], body: T.Conditional(TParam, T.Promise(T.Infer("U")), T.TypeParam("U"), TParam) })
    const WrappedString = yield* T.type("WrappedString", {
      params: [TParam],
      body: T.Conditional(T.Tuple(TParam), T.Tuple(T.String), T.Literal(true), T.Literal(false)),
    })
    const wrappedString = yield* T.const(
      "wrappedString",
      T.booleanLiteral(false),
      T.Apply(WrappedString, [T.Union(T.String, T.Number)]),
    )
    typeOf(wrappedString).is<false>()
    const pair = yield* T.const(
      "pair",
      T.objectLiteral({ first: T.numberLiteral(1), second: T.numberLiteral(2) }),
      T.Apply(Pair, [T.Number]),
    )
    typeOf(pair).is<{ first: number; second: number }>()
    const unwrapped = yield* T.const(
      "unwrapped",
      T.prop(pair, "first"),
      T.Apply(Unwrap, [T.Promise(T.Number)]),
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
