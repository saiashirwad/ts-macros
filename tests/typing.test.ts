import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emittedSource, typeOf } from "./typing.ts"

const programs = {
  literals: $.build(function*() {
    const kept = yield* $.const("kept", $.number(1))
    typeOf(kept).is<1>().isReadonly()
    const widened = yield* $.let("widened", $.number(1))
    typeOf(widened).is<number>().isMutable()
    const text = yield* $.const("text", $.string("hi"))
    typeOf(text).is<"hi">()
    const flag = yield* $.let("flag", $.boolean(true))
    typeOf(flag).is<boolean>()
    const annotated = yield* $.let("annotated", $.number(2), $.Number)
    typeOf(annotated).is<number>()
    return { kept, widened, text, flag, annotated }
  }),

  compounds: $.build(function*() {
    const point = yield* $.const("point", $.object({ x: $.number(1), y: $.number(2) }))
    typeOf(point).is<{ x: number; y: number }>()
    const x = yield* $.const("x", $.prop(point, "x"))
    typeOf(x).is<number>()
    const list = yield* $.const("list", $.array($.number(1), $.number(2)))
    typeOf(list).is<number[]>()
    const first = yield* $.const("first", $.index(list, $.number(0)))
    typeOf(first).is<number | undefined>()
    const mixed = yield* $.const("mixed", $.array($.string("a"), $.number(1)))
    typeOf(mixed).is<(string | number)[]>()
    const nested = yield* $.let("nested", $.object({ inner: $.object({ ok: $.boolean(true) }) }))
    typeOf(nested).is<
      { inner: { ok: boolean } }
    >()
    return { x, first, mixed, nested }
  }),

  operators: $.build(function*() {
    const a = yield* $.const("a", $.number(3))
    const b = yield* $.const("b", $.number(4))
    const sum = yield* $.const("sum", $.binary("+", a, b))
    typeOf(sum).is<number>()
    const label = yield* $.const("label", $.binary("+", $.string("n="), sum))
    typeOf(label).is<string>()
    const bigger = yield* $.const("bigger", $.binary(">", a, b))
    typeOf(bigger).is<boolean>()
    const either = yield* $.const("either", $.binary("||", label, sum))
    typeOf(either).is<string | number>()
    const falseAnd = yield* $.const("falseAnd", $.binary("&&", $.boolean(false), sum))
    typeOf(falseAnd).is<false>()
    const trueValue = $.hostValue<true>("trueValue")
    const trueAnd = yield* $.const("trueAnd", $.binary("&&", trueValue, $.string("yes")))
    typeOf(trueAnd).is<"yes">()
    const zeroValue = $.hostValue<0>("zeroValue")
    const zeroOr = yield* $.const("zeroOr", $.binary("||", zeroValue, $.string("fallback")))
    typeOf(zeroOr).is<"fallback">()
    const twoValue = $.hostValue<2>("twoValue")
    const nonzeroOr = yield* $.const("nonzeroOr", $.binary("||", twoValue, $.string("fallback")))
    typeOf(nonzeroOr).is<2>()
    const emptyValue = $.hostValue<"">("emptyValue")
    const emptyAnd = yield* $.const("emptyAnd", $.binary("&&", emptyValue, sum))
    typeOf(emptyAnd).is<"">()
    const objectValue = $.hostValue<{ ok: true }>("objectValue")
    const objectAnd = yield* $.const("objectAnd", $.binary("&&", objectValue, $.string("object")))
    typeOf(objectAnd).is<"object">()
    const maybeText = $.hostValue<"" | "x">("maybeText")
    const unionAnd = yield* $.const("unionAnd", $.binary("&&", maybeText, $.number(1)))
    typeOf(unionAnd).is<"" | 1>()
    const broadNumber = $.hostValue<number>("broadNumber")
    const numberAnd = yield* $.const("numberAnd", $.binary("&&", broadNumber, $.string("number")))
    typeOf(numberAnd).is<0 | "number">()
    const broadString = $.hostValue<string>("broadString")
    const stringOr = yield* $.const("stringOr", $.binary("||", broadString, $.number(1)))
    typeOf(stringOr).is<string | 1>()
    const nullValue = $.hostValue<null>("nullValue")
    const nullOr = yield* $.const("nullOr", $.binary("||", nullValue, $.number(1)))
    typeOf(nullOr).is<1>()
    const picked = yield* $.const("picked", $.cond(bigger, a, label))
    typeOf(picked).is<3 | string>()
    const negated = yield* $.const("negated", $.unary("!", bigger))
    typeOf(negated).is<boolean>()
    const kind = yield* $.const("kind", $.unary("typeof", sum))
    const tpl = yield* $.const("tpl", $.template(["<", ">"], either))
    typeOf(tpl).is<string>()
    return { picked, negated, kind, tpl }
  }),

  functions: $.build(function*() {
    const double = yield* $.fn("double", {
      params: [$.param("n", $.Number)],
      body: function*({ n }) {
        typeOf(n).is<number>().isMutable()
        return $.binary("*", n, $.number(2))
      },
    })
    typeOf(double).is<(n: number) => number>()

    const classify = yield* $.fn("classify", {
      params: [$.param("score", $.Number)],
      body: function*({ score }) {
        yield* $.if($.binary(">=", score, $.number(90)), function*() {
          yield* $.return($.string("A"))
        })
        return $.number(0)
      },
    })
    typeOf(classify).is<(score: number) => "A" | 0>()

    const declared = yield* $.fn("declared", {
      params: [$.param("text", $.String), $.optional("times", $.Number), $.rest("tags", $.String)],
      returns: $.String,
      body: function*({ text, times, tags }) {
        typeOf(times).is<number | undefined>()
        typeOf(tags).is<string[]>()
        const savedTimes = yield* $.const("savedTimes", times)
        typeOf(savedTimes).is<number | undefined>()
        const savedTags = yield* $.const("savedTags", tags)
        typeOf(savedTags).is<string[]>()
        return text
      },
    })
    typeOf(declared).is<(text: string, times?: number | undefined, ...tags: string[]) => string>()

    const doubled = yield* $.const("doubled", $.call(double, $.number(21)))
    typeOf(doubled).is<number>()
    const grade = yield* $.const("grade", $.call(classify, doubled))
    typeOf(grade).is<"A" | 0>()
    const shout = yield* $.const("shout", $.call(declared, $.string("hey")))
    typeOf(shout).is<string>()
    const arrowFn = yield* $.const(
      "arrow",
      $.arrow({
        params: [$.optional("maybe", $.String), $.rest("values", $.Number)],
        body: function*({ maybe, values }) {
          const savedMaybe = yield* $.const("savedMaybe", maybe)
          typeOf(savedMaybe).is<string | undefined>()
          const savedValues = yield* $.const("savedValues", values)
          typeOf(savedValues).is<number[]>()
          return $.prop(values, "length") as $.Expr<number>
        },
      }),
    )
    typeOf(arrowFn).is<(maybe?: string | undefined, ...values: number[]) => number>()
    return { grade, shout, arrow: arrowFn }
  }),

  control: $.build(function*() {
    const total = yield* $.let("total", $.number(0))
    typeOf(total).is<number>()
    const words = yield* $.const("words", $.array($.string("a"), $.string("bb")))
    yield* $.forOf("word", words, function*(word) {
      typeOf(word).is<string>().isReadonly()
      yield* $.assign(total, $.binary("+", total, $.prop(word, "length") as $.Expr<number>))
    })
    yield* $.forOf("letter", $.string("abc"), function*(letter) {
      typeOf(letter).is<string>()
      yield* $.if($.binary("===", letter, $.string("b")), function*() {
        yield* $.break()
      })
    })
    yield* $.while($.binary("<", total, $.number(10)), function*() {
      yield* $.assign(total, $.binary("+", total, $.number(1)))
    })
    return { total }
  }),

  writes: $.build(function*() {
    const record = yield* $.let(
      "record",
      $.object({}),
      $.Object({
        name: $.Optional($.String),
        explicit: $.Optional($.Union($.String, $.Undefined)),
      }),
    )
    yield* $.assign($.prop(record, "name"), $.string("ok"))
    yield* $.assign($.prop(record, "explicit"), $.hostValue<undefined>("undefinedValue"))
    const values = yield* $.let("values", $.array($.number(0)), $.Array($.Number))
    yield* $.assign($.index(values, $.number(0)), $.number(1))
    const tuple = $.hostValue<[number, string]>("tuple")
    const first = $.index(tuple, $.number(0))
    const second = $.index(tuple, $.number(1))
    typeOf(first).is<number>()
    typeOf(second).is<string>()
    yield* $.assign(first, $.number(1))
    yield* $.assign(second, $.string("one"))
    return { record, values, tuple }
  }),

  sugar: $.build(function*() {
    const count = yield* $.let("count", 0)
    typeOf(count).is<number>().isMutable()
    const name = yield* $.const("name", "sai")
    typeOf(name).is<"sai">().isReadonly()
    const person = yield* $.const("person", { name, age: 30, tags: ["x"] })
    typeOf(person).is<{ name: string; age: number; tags: string[] }>()
    const older = yield* $.const("older", $.gt($.add(count, 1), 40))
    typeOf(older).is<boolean>()
    yield* $.forOf("tag", $.prop(person, "tags") as $.Expr<string[]>, function*(tag) {
      typeOf(tag).is<string>()
      yield* $.assign(count, $.add(count, 1))
    })
    const greeting = yield* $.const("greeting", $.call($.prop(name, "toUpperCase") as $.Expr<() => string>))
    typeOf(greeting).is<string>()
    return { older, greeting }
  }),

  host: $.build(function*() {
    const fs = $.hostImport<{ readFileSync: (path: string, encoding: string) => string }>("node:fs", "fs")
    const raw = yield* $.const(
      "raw",
      $.call($.prop(fs, "readFileSync") as $.Expr<(path: string, encoding: string) => string>, "a.txt", "utf8"),
    )
    typeOf(raw).is<string>()
    const parse = $.hostValue<(text: string) => { id: number }>("parse")
    const record = yield* $.const("record", $.call(parse, raw))
    typeOf(record).is<{ id: number }>()
    const id = yield* $.const("id", $.prop(record, "id"))
    typeOf(id).is<number>()
    const shown = yield* $.const(
      "shown",
      $.call($.prop($.hostValue<JSON>("JSON"), "stringify") as $.Expr<(value: unknown) => string>, record),
    )
    typeOf(shown).is<string>()
    return { id, shown }
  }),

  freshness: $.build(function*() {
    const Letter = $.Union($.Literal("a"), $.Literal("b"))
    const pick = yield* $.fn("pick", {
      params: [$.param("letters", $.Array(Letter)), $.param("flag", $.Object({ ok: $.Literal(true) }))],
      body: function*({ letters, flag }) {
        const first = yield* $.let("first", $.index(letters, $.number(0)))
        typeOf(first).is<"a" | "b" | undefined>()
        yield* $.forOf("letter", letters, function*(letter) {
          typeOf(letter).is<"a" | "b">()
          yield* $.assign(first, letter)
        })
        const copy = yield* $.const("copy", flag)
        typeOf(copy).is<{ ok: true }>()
        return copy
      },
    })
    typeOf(pick).is<(letters: ("a" | "b")[], flag: { ok: true }) => { ok: true }>()

    const one = yield* $.const("one", $.number(1))
    typeOf(one).is<1>()
    const widened = yield* $.let("widened", one)
    typeOf(widened).is<number>()
    const wrapped = yield* $.const("wrapped", $.object({ value: one }))
    typeOf(wrapped).is<{ value: number }>()
    const pinned = yield* $.const("pinned", $.number(1), $.Literal(1))
    const kept = yield* $.let("kept", pinned)
    typeOf(kept).is<1>()
    const either = yield* $.let("either", $.cond($.boolean(true), $.string("x"), pinned))
    typeOf(either).is<string | 1>()
    return { widened, wrapped, kept, either }
  }),

  generics: $.build(function*() {
    const T = $.TypeParam("T")
    const identity = yield* $.fn("identity", {
      typeParams: [T],
      params: [$.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    const numberIdentity = $.instantiate(identity, $.Number)
    typeOf(numberIdentity).is<(value: number) => number>()
    const same = yield* $.const("same", $.call(numberIdentity, $.number(7)))
    typeOf(same).is<number>()

    const Pair = yield* $.type("Pair", { params: [T], body: $.Object({ first: T, second: T }) })
    const Unwrap = yield* $.type("Unwrap", { params: [T], body: $.Conditional(T, $.Promise($.Infer("U")), $.TypeParam("U"), T) })
    const WrappedString = yield* $.type("WrappedString", {
      params: [T],
      body: $.Conditional($.Tuple(T), $.Tuple($.String), $.Literal(true), $.Literal(false)),
    })
    const wrappedString = yield* $.const(
      "wrappedString",
      $.boolean(false),
      $.Apply(WrappedString, [$.Union($.String, $.Number)]),
    )
    typeOf(wrappedString).is<false>()
    const pair = yield* $.const(
      "pair",
      $.object({ first: $.number(1), second: $.number(2) }),
      $.Apply(Pair, [$.Number]),
    )
    typeOf(pair).is<{ first: number; second: number }>()
    const unwrapped = yield* $.const(
      "unwrapped",
      $.prop(pair, "first"),
      $.Apply(Unwrap, [$.Promise($.Number)]),
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
