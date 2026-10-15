# ts-macros

`ts-macros` is typed staged metaprogramming in TypeScript. A TypeScript program builds a program in another language, and the TypeScript compiler checks that program against that language's typing rules while you write the builder.

The package is a small language kernel plus two languages built on it: C and TypeScript.

## Example

```ts
import { emitTs, ts } from "@texoport/ts-macros/languages/typescript"

const program = ts.program(function*() {
  const double = yield* ts.fn(
    "double",
    [ts.param("x", ts.number)],
    ts.number,
    function*(x) {
      yield* ts.return(ts.add(x, x))
    },
  )
  yield* ts.let(ts.number, "answer", ts.call(double, ts.literal(21)))
})

console.log(emitTs(program))
```

Emits:

```text
function double(x: number): number {
  return x + x;
}
let answer: number = double(21);
```

`ts.call(double, ts.literal("21"))` fails with `arguments do not match the parameters`, and `ts.let(ts.string, "s", ts.call(double, ts.literal(21)))` fails with `initializer is not assignable to the declared type`. Both are TypeScript errors in the builder, before any code is emitted.

## C

[`examples/c.ts`](examples/c.ts) builds C with fixed-width integers, pointers, and C's usual arithmetic conversions:

```sh
pnpm install
node examples/c.ts
```

```text
#include <stdint.h>

int64_t sum(int16_t* values, int32_t count) {
  int64_t total = 0;
  int32_t i = 0;
  while (i < count) {
    total = total + *(values + i);
    i = i + 1;
  }
  return total;
}
int32_t main(void) {
  int16_t x = 42;
  sum(&x, 1);
  return 0;
}
```

Passing `int16_t*` where `double*` is expected, returning a pointer from an `int` function, or initializing a C binding with a TypeScript expression is a type error. Rules that types cannot express, such as literal ranges, constant top-level initializers, and nested functions, are checked when `c.program` runs.

## TypeScript's type system

The TypeScript language builds TypeScript types as nodes: primitives, literal and template literal types, objects with `readonly` and optional fields, arrays, tuples, unions, intersections, function types, `keyof`, indexed access, generic aliases, conditional types with `infer`, and mapped types with modifiers and key remapping. A type node denotes the TypeScript type it spells, so TypeScript computes and checks it while you write the builder.

[`examples/typescript.ts`](examples/typescript.ts):

```ts
import { emitTs, ts } from "@texoport/ts-macros/languages/typescript"

const program = ts.program(function*() {
  const Getters = yield* ts.alias(
    "Getters",
    [ts.typeParam("T")],
    (T) =>
      ts.mapped("K", ts.keyof(T), (K) => ts.functionType([], ts.index(T, K)), {
        as: (K) => ts.template("get_", ts.intersection(K, ts.string)),
      }),
  )
  const user = ts.object({ name: ts.string, age: ts.optional(ts.number) })
  yield* ts.fn(
    "show",
    [ts.param("getters", Getters(user))],
    ts.void,
    function*() {},
  )

  yield* ts.fn(
    "label",
    [ts.param("value", ts.union(ts.string, ts.number, ts.null))],
    ts.string,
    function*(value) {
      yield* ts.if(ts.typeOf(value, "string"), function*(text) {
        yield* ts.return(text)
      }, function*(other) {
        yield* ts.if(ts.notNull(other), function*(count) {
          yield* ts.return(ts.add(ts.literal("#"), count))
        })
      })
      yield* ts.return(ts.literal("none"))
    },
  )
})

console.log(emitTs(program))
```

Emits:

```text
type Getters<T> = { [K in keyof T as `get_${K & string}`]: () => T[K] };
function show(getters: Getters<{ name: string; age?: number }>): void {}
function label(value: string | number | null): string {
  if (typeof value === "string") {
    return value;
  } else {
    if (value != null) {
      return "#" + value;
    }
  }
  return "none";
}
```

`Getters(user)` denotes `{ get_name: () => string; get_age?: () => number | undefined }`. An alias body is a callback that TypeScript checks generically, so `ts.index(T, K)` is rejected when `K` is not known to be a key of `T`. Calling an alias checks its arguments against the parameter constraints.

A guard narrows its subject in each branch: the branch callback receives a reference with the narrowed type, and the else branch gets the rest. The guards are `ts.typeOf`, `ts.notNull`, `ts.isNull`, `ts.isArray`, `ts.not`, and a call to a function whose result is `ts.predicate(i, T)`. Each one narrows as TypeScript does. Above, `ts.add(ts.literal("#"), value)` fails with `operands cannot be added`, because `value` may be `null`. Assigning to a narrowed reference is checked against the declared type. A program is rejected when it uses a narrowed reference outside its branch, in a function nested in the branch, or after its binding may have been assigned.

Limits:

- An alias takes at most four type parameters, and a constraint cannot refer to another parameter. Write `ts.index(T, ts.intersection(K, ts.keyof(T)))` where TypeScript code would write `K extends keyof T`.
- `ts.infer` binds at most four variables, and an `infer` variable has no constraint.
- Type variables are looked up by name when a type is evaluated. A program is rejected when a mapped key or `infer` variable is used where another of the same name shadows it.
- An alias cannot refer to itself.

## Define a language

A language is a name and a record of capabilities. Each capability is a typing rule written as a type lambda. Constructs state the capabilities they need, so `lang.ifConstruct<L>()` is a type error for a language without a `Truthy` rule.

```ts
import * as lang from "@texoport/ts-macros"

interface CalcSum extends lang.TypeLambda {
  readonly type: this["Args"] extends readonly [number, number] ? number : never
}

interface Calc {
  readonly name: "calc"
  readonly Assign: lang.Assignable
  readonly Sum: CalcSum
}

interface NumberNode {
  readonly kind: "number"
  readonly value: number
}

const numberClass = lang.exprClass<NumberNode>()
const numberType = lang.typeClass()

const calc = {
  ...lang.letConstruct<Calc>(),
  ...lang.addConstruct<Calc>(),
  num: lang.typeNode<Calc, number, { readonly kind: "num-type" }>(numberType, {
    kind: "num-type",
  }),
  number: (value: number) =>
    lang.expr<Calc, number, { readonly kind: "number" }>(numberClass, {
      kind: "number",
      value,
    }),
  program: lang.builder<Calc>(),
}

const target = lang.defineTarget({
  valid: (name) => /^[a-z]+$/.test(name),
  reserved: new Set(["let"]),
}, {
  "num-type": () => "",
  number: (node: NumberNode) => String(node.value),
  ref: (node: lang.RefNode, emit) => emit.name(node.binding),
  add: (node: lang.BinaryNode, emit) =>
    `${emit.node(node.left).text} + ${emit.node(node.right).text}`,
  let: (node: lang.LetNode, emit) =>
    `let ${emit.name(node.binding)} = ${emit.node(node.init).text}`,
})

const program = calc.program(function*() {
  const x = yield* calc.let(calc.num, "x", calc.number(1))
  yield* calc.let(calc.num, "y", calc.add(x, calc.number(2)))
})

console.log(lang.emit(program, target))
```

A program's type lists every node kind it uses, nested ones included. `lang.emit` is a type error unless the target has a handler for each of them. A target may handle more kinds than a program uses.

The kernel lives in [`src/lang`](src/lang). [`languages/c.ts`](languages/c.ts) and [`languages/typescript.ts`](languages/typescript.ts) are complete languages that share the kernel's constructs.

## Package entry points

| Import                                     | Contents                                          |
| ------------------------------------------ | ------------------------------------------------- |
| `@texoport/ts-macros`                      | The kernel: nodes, rules, constructs, targets     |
| `@texoport/ts-macros/languages/c`          | `c`, `cTarget`, `emitC`, and the C type encoding  |
| `@texoport/ts-macros/languages/typescript` | `ts`, `tsTarget`, `emitTs`, and the type meanings |

See [`tests/type-verification.md`](tests/type-verification.md) for how type rules are verified.
