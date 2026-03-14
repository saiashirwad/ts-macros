Grouped by what they unlock:

---

**Program algebra**

The highest-leverage addition. Right now `runMacro` produces a `Program<T>` but
programs can't compose with each other. Add:

```ts
const baseProgram = runMacro(function* () { ... });

const extended = runMacro(function* () {
  const Result = yield* $.import(baseProgram); // refs from another program flow in
  const ok = yield* $.function("ok").pipe($.returns(type.apply(Result, ...)));
});
```

Programs become modules. Macros become composable across files. Everything else
in this list gets dramatically more useful once programs can import each other's
typed refs.

---

**Opaque / nominal types**

TypeScript's structural typing is its biggest correctness gap. You need:

```ts
const UserId = yield * $.type("UserId").pipe($.opaque(type.number()));
const PostId = yield * $.type("PostId").pipe($.opaque(type.number()));
// UserId and PostId are not assignable to each other or to number
```

This is one of the most requested things in TypeScript (Brand types are the
hacky workaround). Yours can do it properly because the IR controls what
assignments are valid.

---

**Typed pattern matching**

Already on your list, but the key is exhaustiveness encoded in the type:

```ts
const value = $.match(result).pipe(
  $.on(type.literal("Ok"), function* ({ value }) {
    return value;
  }),
  $.on(type.literal("Err"), function* ({ error }) {
    return error;
  }),
  // TypeScript errors if a branch is missing
);
```

The `$.match` needs to know the union arms from the `TypeRef` — this is where
the semantic IR really pays off over token-based systems.

---

**Derive macros (typed)**

A `$.derive` that receives the full typed IR of the annotated declaration:

```ts
const User =
  yield *
  $.type("User").pipe(
    $.body(type.object({ id: type.number(), name: type.string() })),
    $.derive(Eq), // generates: equals(a: User, b: User): boolean
    $.derive(Codec), // generates: encode(u: User): Json, decode(j: Json): Result<User, Error>
  );
```

`Eq` and `Codec` are functions `(TypeRef<T>) => Program<...>`. The derived
declarations know the exact shape of `T`. TypeScript verifies the generated
code. One declaration, multiple verified derivatives.

---

**Effect tracking**

Generalises async properly:

```ts
const fetchUser = yield* $.function("fetchUser").pipe(
  $.params($.p("id", UserId)),
  $.effects($.io, $.throws(NotFoundError)),
  $.impl(function* ({ id }) { ... }),
);
// FunctionRef carries the effect set in its phantom type
// calling fetchUser in a pure context is a type error
```

This is what Effect-TS approximates with `Effect<R, E, A>` but bolted onto an
existing language. Yours can encode it properly in the IR from the start.

---

**Row polymorphism**

Open record types that can be extended — critical for composable APIs and
middleware patterns:

```ts
const HasId = type.row({ id: type.number() });
const HasName = type.row({ name: type.string() });
const User = type.extend(HasId, HasName); // { id: number, name: string }

// function that works on any record with at least { id: number }
const findById =
  yield *
  $.function("findById").pipe(
    $.typeParams(R),
    $.params($.p("record", type.has(R, HasId))),
    $.returns(type.get(R, "id")),
  );
```

TypeScript's intersection types are the blunt workaround. Proper rows compose
algebraically.

---

**Program transformation**

Map/fold over declarations — this is meta-meta-programming:

```ts
const withLogging = <T>(program: Program<T>): Program<T> =>
  program.mapDeclarations(decl =>
    decl._tag === "FunctionDecl" ? wrapWithLogger(decl) : decl
  );

const withTracing = <T>(program: Program<T>): Program<T> => ...;

const productionProgram = pipe(baseProgram, withLogging, withTracing);
```

This is where "macros that transform other macros" lives. The typed IR makes
these transformations verifiable — `mapDeclarations` can enforce that the output
has the same declaration shape as the input.

---

**Refinement types**

Value-level predicates embedded in the type, verified at construction:

```ts
const PositiveInt =
  yield *
  $.type("PositiveInt").pipe(
    $.body(type.refined(type.number(), n => $.gt(n, $.number(0)))),
  );
// PositiveInt's smart constructor rejects at compile time if the literal is <= 0
// $.number(-1) annotated as PositiveInt → type error
```

With dependent types this becomes: proofs that values satisfy predicates, not
just runtime assertions.

---

**Hygiene**

Less sexy but critical once you have derive macros generating names:

```ts
// derived "equals" for User shouldn't accidentally shadow a user-defined "equals"
// generated names need guaranteed freshness
$.freshName("equals"); // generates a hygienic identifier
```

Without hygiene, any sufficiently large derive macro will have name collision
bugs. This needs to be in the IR from the start, not bolted on.

---

The order I'd do them: **program composition** first (everything composes
better), then **opaque types** (immediate practical value, correctness), then
**derive macros** (the multiplier), then **pattern matching** (already on your
list), then the rest as the surface demands them.
