# `new/` Reimplementation Roadmap

## Purpose

This document is the working plan for the clean reimplementation of the library
in `new/`.

The point of `new/` is not to slowly wrap the old system. The point is to
rebuild the core ideas from first principles, with a tracer-bullet approach,
until the new API feels obviously correct.

This is intentionally a risky path. That is fine. This is a library, and the
goal is to find the right shape, not to preserve compatibility at all costs.

## Current product taste and design sensibility

The reimplementation is aiming to preserve the aesthetic sensibility of the
existing codebase, especially the feel visible in `class.ts` and `ffi.ts`.

That sensibility looks like this:

- declarations are explicit and inspectable
- the system is compositional through refs returned by `yield*`
- witnesses are preferred over stringly magic
- the API should feel honest rather than compiler-clever
- escape hatches like FFI are good, but they should not become the whole model
- the system should stay pleasant to read top-to-bottom

Two especially important constraints emerged during the work:

- `yield*` must remain the declaration boundary
- the result of `yield*` must remain a reusable ref that composes into later
  declarations

Pipeability is meant to improve the authoring experience before `yield*`. It is
not meant to replace the ref graph that appears after `yield*`.

## High-level goal API

This is the direction we are building toward:

```ts
const T = type.param("T");
const E = type.param("E");

const Result =
  yield *
  $.type("Result").pipe(
    $.typeParams(T, E),
    $.body(
      type.union(
        type.object({ _tag: type.literal("Ok"), value: T }),
        type.object({ _tag: type.literal("Err"), error: E }),
      ),
    ),
  );

const ok =
  yield *
  $.function("ok").pipe(
    $.typeParams(T, E),
    $.params($.p("value", T)),
    $.returns(type.apply(Result, T, E)),
    $.impl(function* ({ value }) {
      return $.object({
        _tag: $.literal("Ok"),
        value,
      });
    }),
  );

const result =
  yield *
  $.let("result").pipe(
    $.init(
      $.call($.instantiate(ok, type.number(), type.string()), [$.number(1)]),
    ),
    $.annotate(type.apply(Result, type.number(), type.string())),
  );
```

Important: the key invariant is not the exact spellings above. The key invariant
is:

- pipeable builder before `yield*`
- typed reusable ref after `yield*`

## Important type design choice already decided

`$.string("Ok")` should default to `Expr<string>`.

It should not silently become `Expr<"Ok">` by default.

Literal precision on the value side should be explicit, for example through a
dedicated literal constructor or a future const-like mechanism. This is
important because the default value-level ergonomics should stay unsurprising
and not infect the whole DSL with accidental literal narrowness.

On the type side, `type.literal("Ok")` should remain the explicit way to model
literal types.

## What has already been implemented in `new/`

### Public module surface

- `new/$.ts`
- `new/type.ts`

The public API is now exposed as module namespaces rather than giant runtime
objects.

The intended consumption shape is:

```ts
import * as $ from "./$";
import * as type from "./type";
```

That keeps the desired callsite feel while making the internal architecture much
easier to evolve.

### Pipeable foundation

- `new/pipeable.ts`

The pipeable layer is based on the Effect style:

- `.pipe(...)` stays tiny
- semantics live in standalone unary combinators
- builders and expression/type nodes can all become pipeable as needed

### Foundation layer

- `new/foundation/expr.ts`
- `new/foundation/type-expr.ts`
- `new/foundation/declaration.ts`
- `new/foundation/program.ts`

These are intentionally small base interfaces rather than a giant central node
union.

### Runtime

- `new/runtime/run-macro.ts`

There is a minimal macro runner that executes a generator and collects
declarations plus the final yielded result.

### Refs

- `new/refs/var-ref.ts`
- `new/refs/function-ref.ts`
- `new/refs/type-ref.ts`

These are the post-`yield*` reusable currency of the system.

### Implemented declaration families

- `new/declarations/let.ts`
- `new/declarations/function.ts`
- `new/declarations/type.ts`

Current supported shapes:

- `$.let("x").pipe($.init(...), $.annotate(...))`
- `$.function("f").pipe($.params(...), $.returns(...), $.impl(...))`
- `$.type("T").pipe($.typeParams(...), $.body(...))`
- `$.instantiate(genericFunctionRef, ...)`

### Implemented shared function machinery

- `new/functions/params.ts`

This holds shared parameter typing helpers without tangling ownership between
function declarations and function refs.

### Implemented value-side primitives and expressions

- `new/primitives/number.ts`
- `new/primitives/string.ts`
- `new/expressions/object.ts`

Current supported value-level expressions:

- `$.number(...)`
- `$.string(...)`
- `$.object({ ... })`
- `$.call(...)`
- `$.instantiate(...)` returning a callable specialized function expression

### Implemented type-level primitives and constructors

- `new/type-level/param.ts`
- `new/type-level/apply.ts`
- `new/type-level/object.ts`
- `new/type-level/literal.ts`
- `new/type-level/union.ts`

Current supported type-level expressions:

- `type.number()`
- `type.string()`
- `type.param("T")`
- `type.apply(...)`
- `type.object({ ... })`
- `type.literal(...)`
- `type.union(...)`

### Compiler playground

- `new/playground.ts`
- `new/play.ts`

This is the main type-driven experimentation file.

The workflow is:

- encode examples there
- use `show<T>(value)` assertions to probe types
- run `bun tsgo`
- let compiler errors guide the next move

This is the right workflow for the reimplementation.

`new/play.ts` is the cleaner showcase specimen:

- one generic `Result<T, E>` type
- one generic `identity<T>` function
- explicit specialization with `$.instantiate(...)`
- one final typed `result`

It is meant to stay screenshot-friendly and much less noisy than
`playground.ts`.

## What the playground currently proves

The current tracer bullets prove all of these:

- `$.let(...)` is pipeable before `yield*`
- `yield* $.let(...)` returns a typed `VarRef`
- `$.function(...)` is pipeable before `yield*`
- `yield* $.function(...)` returns a typed `FunctionRef`
- `$.type(...)` is pipeable before `yield*`
- `yield* $.type(...)` returns a typed `TypeRef`
- generic type params can be declared with `type.param(...)`
- generic binders can be attached with `$.typeParams(...)`
- `type.apply(...)` works on yielded type refs, not just names
- substitution flows through `type.object(...)`
- substitution flows through `type.union(...)`
- generic function refs can be explicitly specialized with `$.instantiate(...)`
- specialized generic function expressions can be passed to `$.call(...)`
- function return type can be inferred from `$.impl(...)` when no explicit
  `$.returns(...)` is given
- explicit `$.returns(...)` still works when present
- explicit return annotations that disagree with `$.impl(...)` are rejected
- value-side object construction can use previously yielded refs

The playground already includes realistic examples like:

- `Box<T> = { value: T }`
- `Result<T, E> = { _tag: "Ok"; value: T } | { _tag: "Err"; error: E }`
- `genericIdentity<T>(value: T): T`
- `$.call($.instantiate(genericIdentity, type.number()), [x])`
- generic functions whose return type is inferred directly from `$.impl(...)`

## Architectural decisions already made

### 1. No god-file

`new/core.ts` was a temporary staging file and has been removed.

The current structure is intentionally split by semantic family.

### 2. No central global tag registry

Node kinds should stay local to the files that define them.

Use string `_tag` discriminants for semantic kinding. Use unique symbols for
phantom typing and hidden protocol markers.

Do not introduce a central repository of tags unless external tooling or
serialization pressures force it later.

### 3. Public surfaces should be module namespaces

`$` and `type` should be barrels, not big runtime objects.

This matches the desired callsite while keeping the implementation clean.

### 4. Default value literals should stay widened

- `$.string("Ok")` should be `Expr<string>`
- `$.number(1)` should be `Expr<number>`

Literal narrowness should be explicit, not ambient.

### 5. Type-level literal precision should stay explicit

- `type.literal("Ok")` is the right tool for discriminants

### 6. Builder configuration and ref composition are separate concerns

Before `yield*`:

- we are configuring a declaration builder

After `yield*`:

- we are composing with a reusable ref

That is one of the most important invariants in the whole design.

### 7. Function return typing can now be inferred from implementation

This was an important design pivot.

Originally, `$.returns(...)` was effectively required because the function
builder carried an unresolved return type that `$.impl(...)` could only check,
not establish.

Now the rule is:

- if no explicit `$.returns(...)` was provided, `$.impl(...)` may infer and set
  the function return type
- if `$.returns(...)` was provided, `$.impl(...)` must agree with it

This keeps explicit declaration headers available while making common generic
helpers feel much less noisy.

## Current file layout in `new/`

```txt
new/
  $.ts
  type.ts
  pipeable.ts
  playground.ts

  foundation/
    declaration.ts
    expr.ts
    program.ts
    type-expr.ts

  runtime/
    run-macro.ts

  refs/
    function-ref.ts
    type-ref.ts
    var-ref.ts

  functions/
    params.ts

  declarations/
    function.ts
    let.ts
    type.ts

  expressions/
    object.ts

  primitives/
    number.ts
    string.ts

  type-level/
    apply.ts
    literal.ts
    object.ts
    param.ts
    union.ts
```

## The next big goals

### Goal 1: Deepen generic functions

This is probably the next most important milestone.

Target shape:

```ts
const T = type.param("T");

const identity =
  yield *
  $.function("identity").pipe(
    $.typeParams(T),
    $.params($.p("value", T)),
    $.returns(T),
    $.impl(function* ({ value }) {
      return value;
    }),
  );
```

What already exists:

- `$.typeParams(...)` support on function declarations
- parameter type expressions that can use type params
- return type expressions that can use type params
- `FunctionRef` typing that reflects generic binders honestly
- explicit generic specialization via `$.instantiate(...)`
- return inference from `$.impl(...)` when no explicit `$.returns(...)` is
  present

What still needs to be explored:

- whether generic specialization should stay entirely separate from
  `$.call(...)`
- whether partial specialization should ever exist
- whether function type application should also have a type-level mirror
- how generic helper functions like `ok<T, E>` returning `Result<T, E>` should
  feel in real examples

This is the next place where the design could either get clearer or get messy,
so it is worth doing carefully.

### Goal 2: Value-side discriminated union ergonomics

We can already annotate values with discriminated union types, but the value
side is still slightly coarse.

Potential future additions:

- explicit value literal constructor for narrow literals
- maybe `$.literal("Ok")` on the value side
- maybe a future const-like helper if it feels honest

This should be explicit and opt-in.

### Goal 3: More useful expression constructors

Possible near-term additions:

- arrays
- tuples
- property access
- indexing
- unary and binary operators
- conditional expressions

These should only be added when the playground actually needs them.

### Goal 4: More useful type constructors

Likely future additions:

- tuples
- arrays
- records
- intersections
- maybe function type expressions

Again, add only what is needed to drive realistic examples.

### Goal 5: Classes

Classes should come later, after:

- type refs are stable
- generic binders are stable
- generic application is stable
- function declarations are more mature

Classes will pull together several concerns at once:

- value-level refs
- type-level refs
- members
- methods
- constructors
- `Self` patterns

They should be built on top of the earlier tracer bullets, not used as the place
where those tracer bullets are first discovered.

### Goal 6: FFI integration

FFI should remain an escape hatch for imported or especially complex external
types.

The rough intended boundary is:

- local structure uses native DSL types
- imported complexity can use FFI-backed witnesses

This should come after the core local generic model feels solid.

## Recommended implementation order from here

### Phase 1: Stabilize generic function composition

1. Build realistic helpers like `ok<T, E>` and `err<T, E>` returning applied
   generic types
2. Check that `$.instantiate(...)` stays pleasant in real call sites
3. Decide whether `$.call(...)` should remain monomorphic over callable
   expressions
4. Only then consider any shorthand for generic invocation

### Phase 2: Add explicit value literals for narrow cases

1. Introduce a value-level explicit literal constructor if still needed
2. Keep `$.string(...)` and `$.number(...)` widened by default
3. Verify discriminated-union construction stays pleasant without hidden magic

### Phase 3: Expand expressions only when driven by examples

Add expression nodes as the playground demands them. Do not try to predictively
build a whole language surface too early.

### Phase 4: Expand type constructors only when driven by examples

Same principle as expressions.

### Phase 5: Start the class tracer bullet

Only after functions plus generics feel stable.

### Phase 6: Revisit emission, inference, and semantic lowering

The current `new/` work is mostly about API shape and phantom typing.

Eventually we will need:

- richer runtime node shapes
- emission/lowering strategy
- generic substitution beyond phantom-only shape
- maybe symbol hygiene or declaration ids

But those should come after the surface feels right.

## What not to do yet

- do not build a compatibility layer with the old implementation
- do not introduce implicit naming sugar yet
- do not centralize tags
- do not overbuild a validation or inference engine too early
- do not add many primitives just because they might someday be useful
- do not let pipeability become magic that hides where declarations happen

## Rules of thumb for future sessions

When working in `new/`, prefer these habits:

- use `new/playground.ts` as the primary design harness
- add `show<T>(...)` probes aggressively
- run `bun tsgo` to validate the type story
- prefer tracer bullets over broad architecture passes
- preserve the `yield*` ref model at all costs
- keep default behavior unsurprising
- make cleverness explicit rather than ambient

## Session handoff summary

If a future session needs a concise mental model, use this:

- `new/` is a clean-room reimplementation
- the current backbone is working:
  - pipeable declaration builders
  - reusable refs after `yield*`
  - generic type declarations
  - generic type application
  - generic function declarations
  - explicit generic function specialization
  - function return inference from `$.impl(...)`
  - structured object and union types
- default value literals are intentionally widened
- literal precision should be explicit
- the next major milestone is richer generic function composition

## Current verification command

Typecheck the playground and current `new/` surface with:

```sh
bun tsgo
```
