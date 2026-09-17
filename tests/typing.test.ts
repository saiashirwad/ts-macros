import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Sugar from "../src/sugar/index.ts"
import * as Type from "../src/types/index.ts"
import { emittedSource, emittedTypecheck, typeOf } from "./typing.ts"

// Each program below checks the phantom of every reference it creates, inline,
// right where the reference is made. At the end, every program is also emitted
// with its inferred types written out and handed to the TypeScript compiler.

const programs = {
  literals: Program.build(function*() {
    const kept = yield* Binding.Const("kept").pipe(Binding.Init(Expr.Number(1)))
    typeOf(kept).is<1>().isReadonly()
    const widened = yield* Binding.Let("widened").pipe(Binding.Init(Expr.Number(1)))
    typeOf(widened).is<number>().isMutable()
    const text = yield* Binding.Const("text").pipe(Binding.Init(Expr.String("hi")))
    typeOf(text).is<"hi">()
    const flag = yield* Binding.Let("flag").pipe(Binding.Init(Expr.Boolean(true)))
    typeOf(flag).is<boolean>()
    const annotated = yield* Binding.Let("annotated").pipe(Binding.Annotate(Type.Number()), Binding.Init(Expr.Number(2)))
    typeOf(annotated).is<number>()
    return { kept, widened, text, flag, annotated }
  }),

  compounds: Program.build(function*() {
    const point = yield* Binding.Const("point").pipe(Binding.Init(Expr.Object({ x: Expr.Number(1), y: Expr.Number(2) })))
    typeOf(point).is<{ x: number; y: number }>()
    const x = yield* Binding.Const("x").pipe(Binding.Init(Expr.Prop(point, "x")))
    typeOf(x).is<number>()
    const list = yield* Binding.Const("list").pipe(Binding.Init(Expr.Array(Expr.Number(1), Expr.Number(2))))
    typeOf(list).is<number[]>()
    const first = yield* Binding.Const("first").pipe(Binding.Init(Expr.Index(list, Expr.Number(0))))
    typeOf(first).is<number>()
    const mixed = yield* Binding.Const("mixed").pipe(Binding.Init(Expr.Array(Expr.String("a"), Expr.Number(1))))
    typeOf(mixed).is<(string | number)[]>()
    const nested = yield* Binding.Let("nested").pipe(Binding.Init(Expr.Object({ inner: Expr.Object({ ok: Expr.Boolean(true) }) })))
    typeOf(nested).is<
      { inner: { ok: boolean } }
    >()
    return { x, first, mixed, nested }
  }),

  operators: Program.build(function*() {
    const a = yield* Binding.Const("a").pipe(Binding.Init(Expr.Number(3)))
    const b = yield* Binding.Const("b").pipe(Binding.Init(Expr.Number(4)))
    const sum = yield* Binding.Const("sum").pipe(Binding.Init(Expr.Binary("+", a, b)))
    typeOf(sum).is<number>()
    const label = yield* Binding.Const("label").pipe(Binding.Init(Expr.Binary("+", Expr.String("n="), sum)))
    typeOf(label).is<string>()
    const bigger = yield* Binding.Const("bigger").pipe(Binding.Init(Expr.Binary(">", a, b)))
    typeOf(bigger).is<boolean>()
    const either = yield* Binding.Const("either").pipe(Binding.Init(Expr.Binary("||", label, sum)))
    typeOf(either).is<string | number>()
    const picked = yield* Binding.Const("picked").pipe(Binding.Init(Expr.Cond(bigger, a, label)))
    typeOf(picked).is<3 | string>()
    const negated = yield* Binding.Const("negated").pipe(Binding.Init(Expr.Unary("!", bigger)))
    typeOf(negated).is<boolean>()
    const kind = yield* Binding.Const("kind").pipe(Binding.Init(Expr.Unary("typeof", sum)))
    typeOf(kind).is<
      "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
    >()
    const tpl = yield* Binding.Const("tpl").pipe(Binding.Init(Expr.Template(["<", ">"], either)))
    typeOf(tpl).is<string>()
    return { picked, negated, kind, tpl }
  }),

  functions: Program.build(function*() {
    const double = yield* Fn.Function("double").pipe(
      Fn.Params(Fn.Param("n", Type.Number())),
      Fn.Impl(function*({ n }) {
        typeOf(n).is<number>().isMutable()
        return Expr.Binary("*", n, Expr.Number(2))
      }),
    )
    typeOf(double).is<(n: number) => number>()

    const classify = yield* Fn.Function("classify").pipe(
      Fn.Params(Fn.Param("score", Type.Number())),
      Fn.Impl(function*({ score }) {
        yield* Stmt.If(Expr.Binary(">=", score, Expr.Number(90)), function*() {
          yield* Stmt.Return(Expr.String("A"))
        })
        return Expr.Number(0)
      }),
    )
    typeOf(classify).is<(score: number) => "A" | 0>()

    const declared = yield* Fn.Function("declared").pipe(
      Fn.Params(Fn.Param("text", Type.String()), Fn.Optional("times", Type.Number()), Fn.Rest("tags", Type.String())),
      Fn.Returns(Type.String()),
      Fn.Impl(function*({ text, times, tags }) {
        typeOf(times).is<number | undefined>()
        typeOf(tags).is<string[]>()
        const savedTimes = yield* Binding.Const("savedTimes").pipe(Binding.Init(times))
        typeOf(savedTimes).is<number | undefined>()
        const savedTags = yield* Binding.Const("savedTags").pipe(Binding.Init(tags))
        typeOf(savedTags).is<string[]>()
        return text
      }),
    )
    typeOf(declared).is<(text: string, times?: number | undefined, ...tags: string[]) => string>()

    const doubled = yield* Binding.Const("doubled").pipe(Binding.Init(Fn.Call(double, Expr.Number(21))))
    typeOf(doubled).is<number>()
    const grade = yield* Binding.Const("grade").pipe(Binding.Init(Fn.Call(classify, doubled)))
    typeOf(grade).is<"A" | 0>()
    const shout = yield* Binding.Const("shout").pipe(Binding.Init(Fn.Call(declared, Expr.String("hey"))))
    typeOf(shout).is<string>()
    const arrow = yield* Binding.Const("arrow").pipe(
      Binding.Init(
        Fn.Arrow([Fn.Optional("maybe", Type.String()), Fn.Rest("values", Type.Number())], function*({ maybe, values }) {
          const savedMaybe = yield* Binding.Const("savedMaybe").pipe(Binding.Init(maybe))
          typeOf(savedMaybe).is<string | undefined>()
          const savedValues = yield* Binding.Const("savedValues").pipe(Binding.Init(values))
          typeOf(savedValues).is<number[]>()
          return Expr.Prop(values, "length")
        }),
      ),
    )
    typeOf(arrow).is<(maybe?: string | undefined, ...values: number[]) => number>()
    return { grade, shout, arrow }
  }),

  control: Program.build(function*() {
    const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
    typeOf(total).is<number>()
    const words = yield* Binding.Const("words").pipe(Binding.Init(Expr.Array(Expr.String("a"), Expr.String("bb"))))
    yield* Stmt.ForOf("word", words, function*(word) {
      typeOf(word).is<string>().isReadonly()
      yield* Stmt.Assign(total, Expr.Binary("+", total, Expr.Prop(word, "length")))
    })
    yield* Stmt.ForOf("letter", Expr.String("abc"), function*(letter) {
      typeOf(letter).is<string>()
      yield* Stmt.If(Expr.Binary("===", letter, Expr.String("b")), function*() {
        yield* Stmt.Break()
      })
    })
    yield* Stmt.While(Expr.Binary("<", total, Expr.Number(10)), function*() {
      yield* Stmt.Assign(total, Expr.Binary("+", total, Expr.Number(1)))
    })
    return { total }
  }),

  sugar: Program.build(function*() {
    const count = yield* Sugar.Let("count", 0)
    typeOf(count).is<number>().isMutable()
    const name = yield* Sugar.Const("name", "sai")
    typeOf(name).is<"sai">().isReadonly()
    const person = yield* Sugar.Const("person", { name, age: 30, tags: ["x"] })
    typeOf(person).is<{ name: string; age: number; tags: string[] }>()
    const older = yield* Sugar.Const("older", Sugar.gt(Sugar.add(count, 1), 40))
    typeOf(older).is<boolean>()
    yield* Sugar.ForOf("tag", Expr.Prop(person, "tags"), function*(tag) {
      typeOf(tag).is<string>()
      yield* Sugar.Assign(count, Sugar.add(count, 1))
    })
    const greeting = yield* Sugar.Const("greeting", Sugar.call(Expr.Prop(name, "toUpperCase")))
    typeOf(greeting).is<string>()
    return { older, greeting }
  }),

  host: Program.build(function*() {
    const fs = FFI.Import<{ readFileSync: (path: string, encoding: string) => string }>("node:fs", "fs")
    const raw = yield* Sugar.Const("raw", Sugar.call(Expr.Prop(fs, "readFileSync"), "a.txt", "utf8"))
    typeOf(raw).is<string>()
    const parse = FFI.Value<(text: string) => { id: number }>("parse")
    const record = yield* Binding.Const("record").pipe(Binding.Init(Fn.Call(parse, raw)))
    typeOf(record).is<{ id: number }>()
    const id = yield* Binding.Const("id").pipe(Binding.Init(Expr.Prop(record, "id")))
    typeOf(id).is<number>()
    const shown = yield* Binding.Const("shown").pipe(Binding.Init(Fn.Call(Expr.Prop(FFI.Value<JSON>("JSON"), "stringify"), record)))
    typeOf(shown).is<string>()
    return { id, shown }
  }),

  // a literal type widens only while it is fresh; what was declared is kept
  freshness: Program.build(function*() {
    const Letter = Type.Union(Type.Literal("a"), Type.Literal("b"))
    const pick = yield* Fn.Function("pick").pipe(
      Fn.Params(Fn.Param("letters", Type.Array(Letter)), Fn.Param("flag", Type.Object({ ok: Type.Literal(true) }))),
      Fn.Impl(function*({ letters, flag }) {
        const first = yield* Binding.Let("first").pipe(Binding.Init(Expr.Index(letters, Expr.Number(0))))
        typeOf(first).is<"a" | "b">()
        yield* Stmt.ForOf("letter", letters, function*(letter) {
          typeOf(letter).is<"a" | "b">()
          yield* Stmt.Assign(first, letter)
        })
        const copy = yield* Binding.Const("copy").pipe(Binding.Init(flag))
        typeOf(copy).is<{ ok: true }>()
        return copy
      }),
    )
    typeOf(pick).is<(letters: ("a" | "b")[], flag: { ok: true }) => { ok: true }>()

    const one = yield* Binding.Const("one").pipe(Binding.Init(Expr.Number(1)))
    typeOf(one).is<1>()
    // an unannotated const passes freshness on
    const widened = yield* Binding.Let("widened").pipe(Binding.Init(one))
    typeOf(widened).is<number>()
    const wrapped = yield* Binding.Const("wrapped").pipe(Binding.Init(Expr.Object({ value: one })))
    typeOf(wrapped).is<{ value: number }>()
    // an annotated one does not
    const pinned = yield* Binding.Const("pinned").pipe(Binding.Annotate(Type.Literal(1)), Binding.Init(Expr.Number(1)))
    const kept = yield* Binding.Let("kept").pipe(Binding.Init(pinned))
    typeOf(kept).is<1>()
    const either = yield* Binding.Let("either").pipe(Binding.Init(Expr.Cond(Expr.Boolean(true), Expr.String("x"), pinned)))
    typeOf(either).is<string | 1>()
    return { widened, wrapped, kept, either }
  }),

  generics: Program.build(function*() {
    const T = Type.Param("T")
    const identity = yield* Fn.Function("identity").pipe(
      Fn.TypeParams(T),
      Fn.Params(Fn.Param("value", T)),
      Fn.Returns(T),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    const numberIdentity = Fn.Instantiate(identity, Type.Number())
    typeOf(numberIdentity).is<(value: number) => number>()
    const same = yield* Binding.Const("same").pipe(Binding.Init(Fn.Call(numberIdentity, Expr.Number(7))))
    typeOf(same).is<number>()

    const Pair = yield* Type.Type("Pair", Type.Object({ first: T, second: T })).pipe(Type.TypeParams(T))
    const Unwrap = yield* Type.Type("Unwrap", Type.Conditional(T, Type.Promise(Type.InferVar("U")), Type.Param("U"), T)).pipe(Type.TypeParams(T))
    const pair = yield* Binding.Const("pair").pipe(
      Binding.Annotate(Type.Apply(Pair, [Type.Number()])),
      Binding.Init(Expr.Object({ first: Expr.Number(1), second: Expr.Number(2) })),
    )
    typeOf(pair).is<{ first: number; second: number }>()
    const unwrapped = yield* Binding.Const("unwrapped").pipe(
      Binding.Annotate(Type.Apply(Unwrap, [Type.Promise(Type.Number())])),
      Binding.Init(Expr.Prop(pair, "first")),
    )
    typeOf(unwrapped).is<number>()
    return { same, unwrapped }
  }),
}

// The runtime side, reviewed by hand: every binding annotated with the type
// the builders inferred for it. A line without an annotation is one whose type
// is known only to the phantom (host values, methods of primitives).
const expected = {
  literals: `const kept: 1 = 1;
let widened: number = 1;
const text: "hi" = "hi";
let flag: boolean = true;
let annotated: number = 2;`,

  compounds: `const point: { x: number; y: number } = { x: 1, y: 2 };
const x: number = point.x;
const list: number[] = [1, 2];
const first: number = list[0];
const mixed: (string | number)[] = ["a", 1];
let nested: { inner: { ok: boolean } } = { inner: { ok: true } };`,

  operators: `const a: 3 = 3;
const b: 4 = 4;
const sum: number = a + b;
const label: string = "n=" + sum;
const bigger: boolean = a > b;
const either: string | number = label || sum;
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
  let first: "a" | "b" = letters[0];
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
const pair: Pair<number> = { first: 1, second: 2 };
const unwrapped: Unwrap<Promise<number>> = pair.first;`,
} satisfies { readonly [Name in keyof typeof programs]: string }

for (const [name, program] of Object.entries(programs)) {
  test(`${name}: the inferred types are the ones written out`, () => {
    assert.equal(emittedSource(program), expected[name as keyof typeof expected])
  })
}

test("the emitted programs typecheck with their inferred types written out", () => {
  const diagnostics = emittedTypecheck(programs)
  assert.equal(diagnostics, "", diagnostics)
})
