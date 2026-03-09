Objective

Support a staged `MacroClass` authoring style like:

```ts
class Something extends MacroClass<Something>("Something")({
  impl: function* () {
    const label = yield* $.classProperty("label", type.string());
    const score = yield* $.classProperty("score", type.number());

    return { label, score };
  },
}) {
  *build(self) {
    yield* $.constructor([$.p("label", type.string())], function* ({ label }) {
      yield* $.expression($.assign(self.label, label));
    });

    return {
      label: self.label,
      score: self.score,
    };
  }
}
```

The goal is to keep the current generator-based IR capture model, but split macro-class authoring
into:

- a declaration phase (`impl`) that yields members and returns typed refs
- a build phase (`build(self)`) that consumes those refs and yields constructor/method bodies

Why this is feasible

- The repo already treats yielded class members as the source of truth for codegen.
- `MacroClass` is already a wrapper around `$.class(...)`, not a parser for native TS class syntax.
- `$.constructor(...)` already exists and can be yielded from any class-body generator.
- `ClassMemberRef` already carries the ref identity we need to pass from `impl` into `build(self)`.

Why the current API feels wrong

- Today `MacroClass` forces all emission through `*impl()`.
- The `ctor` and `public` spec in [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1127) is
  manual metadata, so the class body has to repeat facts that the yielded members already know.
- The runtime branch in [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1215) validates that
  yielded members match the metadata instead of just driving from the yielded refs directly.

Recommended shape

Keep the current `MacroClass` mode for compatibility, and add a second staged mode:

```ts
MacroClass<Self>(name)({
  impl: function* () {
    // yield classProperty / classMethod / getters / setters
    // return a typed ref map used by build(self)
  },
  typeParams?: [...]
})
```

with subclasses implementing:

```ts
*build(self: ImplReturn) {
  // yield $.constructor(...)
  // yield $.classMethod(...)
  // optionally return public refs
}
```

Semantics

- `impl`
  - runs first
  - may yield property/method members
  - returns a typed `self` ref map
- `build(self)`
  - runs second
  - receives the injected/finalized refs returned from `impl`
  - may yield constructors, methods, getters, setters, more properties
  - may optionally return the public ref map for external `$.new(...)` typing

Critical design choice: public typing

This is the main place where architecture matters.

Option A: `impl` return is also the public instance shape

- Simple to type.
- Wrong for the proposed API, because `impl` is really an internal `self` map.
- It would leak private/internal refs into the public `ClassRef` type.

Option B: `build(self)` return becomes the public instance shape

- Best fit for the staged design.
- Mirrors existing `$.class(name, body)` behavior, where the body return drives public inference.
- Lets `impl` return internal refs and `build` return only public refs.
- Recommended.

Option C: infer public shape from yielded public members in `build`

- Nice fallback at runtime.
- Harder to model precisely in TypeScript because the yield type does not currently encode enough
  visibility metadata to reconstruct the public object type.
- Good as a runtime fallback, but not the primary type-level contract.

Recommended rule

- `impl` return: internal `self` refs
- `build(self)` return: public refs
- if `build(self)` returns nothing, fall back to opaque `Self` typing, with runtime codegen still
  using yielded members

Code paths to change

1. `src/dsl.ts`: `MacroClass` definition builder

- Current code:
  - [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1127)
- Today it only supports the metadata form:
  - `ctor`
  - `public`
  - `typeParams`
- Change it into a tagged union:
  - legacy mode: current metadata-based shape
  - staged mode: `{ impl, typeParams? }`

Suggested type shape:

```ts
type LegacyMacroClassDefinitionShape<...> = { mode: "legacy"; ... };
type StagedMacroClassDefinitionShape<Impl, Self> = {
  mode: "staged";
  name: string;
  impl: Impl;
  typeParams?: TypeParameter[];
  readonly __self?: Self;
};
```

2. `src/dsl.ts`: `AnyMacroClass` / `MacroClassType`

- Current code assumes macro classes expose `prototype.impl`.
- For staged mode, the subclass needs `prototype.build`.
- Update the shared macro-class types so `$.class(macroClass)` can discriminate:
  - legacy macro class: run `receiver.impl()`
  - staged macro class: run `definition.impl()`, then `receiver.build(self)`

3. `src/dsl.ts`: `MacroClassRefType`

- Current code:
  - [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1081)
- Today the constructor signature comes from `definition.ctor`, and the instance type comes from
  `Self & MacroPublicShape<Public>`.
- In staged mode:
  - constructor args should come from the yielded constructor inside `build(self)`
  - public instance shape should come from the return type of `build(self)`

Recommended helpers:

```ts
type BuildYield<C> =
  C extends { prototype: { build: (...args: any[]) => Generator<infer Y, any, any> } } ? Y : never;

type BuildReturn<C> =
  C extends { prototype: { build: (...args: any[]) => Generator<any, infer R, any> } } ? R : void;

type PublicShapeFromBuild<C> = PublicShapeFromBodyReturn<BuildReturn<C>>;

type StagedInstanceType<C> =
  [PublicShapeFromBuild<C>] extends [never] ? MacroSelfFromClass<C>
  : MacroSelfFromClass<C> & PublicShapeFromBuild<C>;
```

Then derive the constructor with the existing `ExtractConstructorRefType<...>` helper over
`BuildYield<C>`.

4. `src/dsl.ts`: `createClassImpl` macro-class branch

- Current macro-class execution branch:
  - [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1215)
- Legacy mode today:
  - instantiate `receiver`
  - run `receiver.impl()`
  - validate against `ctor/public` metadata
  - delegate into normal `$.class(...)`

Staged mode should instead:

1. instantiate `receiver`
2. run `definition.impl()`
3. yield every member from `impl`
4. capture the returned injected refs as `self`
5. call `receiver.build(self)`
6. yield every member from `build`
7. capture `build` return as `publicReturn`
8. delegate into the normal class finalization path

Important detail:

- When `impl` yields a member, the injected value coming back from the outer class builder may be a
  finalized `ClassMemberRef`.
- That injected ref should be what gets stored in `self`, not the pre-yield placeholder.
- This already matches the existing generator protocol in `createClassPropertyMember` and
  `createClassMethod`.

5. `src/dsl.ts`: instance/public descriptor finalization

- Normal `$.class(name, body)` currently uses:
  - body return first
  - synthesized class members second
  - see [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L1445)
- Reuse that exact rule for staged mode, but apply it to `build(self)` return, not `impl` return.

This keeps one clean story:

- `impl` return is for internal authoring ergonomics
- `build(self)` return is for public `ClassRef` typing

6. `src/index.test.ts`

Add coverage for:

- staged `MacroClass` can lower properties declared in `impl`
- `build(self)` receives typed refs from `impl`
- `$.constructor(...)` yielded from `build(self)` drives `$.new(...)` arg typing
- `build(self)` return drives public instance typing
- legacy metadata-based `MacroClass` still works unchanged

Suggested test shape

```ts
class ScoreBoard extends MacroClass<ScoreBoard>("ScoreBoard")({
  impl: function* () {
    const label = yield* $.classProperty("label", {
      typeAnnotation: type.string(),
      accessibility: "private",
    });
    const score = yield* $.classProperty("score", {
      typeAnnotation: type.number(),
      accessibility: "private",
    });
    return { label, score };
  },
}) {
  *build(self) {
    yield* $.constructor(
      [$.p("label", type.string()), $.p("score", type.number())],
      function* ({ label, score }) {
        yield* $.expression($.assign(self.label, label));
        yield* $.expression($.assign(self.score, score));
      },
    );

    const describe = yield* $.classMethod(
      "describe",
      {},
      function* () {
        return $.template`${self.label}: ${self.score}`;
      },
      { returnType: type.string() },
    );

    return { describe };
  }
}
```

Type-system constraints

1. Native class methods are not the source of truth

- We still cannot inspect ordinary TS methods and turn them into IR.
- `build(self)` must keep yielding DSL members.
- This is still a DSL-on-top-of-a-class, not native class capture.

2. Public-member inference from yields alone is incomplete

- The yield type does not currently preserve enough visibility information for perfect type-level
  public-shape extraction.
- That is why `build(self)` returning public refs is the safest primary contract.

3. `self` typing is easy once `impl` is the source

- This part is actually the nicest part of the design.
- `BodyReturn<Impl>` already exists in `src/dsl.ts`, so `build(self)` can be typed directly from the
  staged spec's `impl` return.

4. Constructor typing is already mostly solved

- `ExtractConstructorRefType<Y>` already exists in
  [`src/dsl.ts`](/Users/home/Code/ts-macros/src/dsl.ts#L371).
- Reuse it against `BuildYield<C>` instead of manual `ctor` metadata.

Implementation order

1. Add staged `MacroClass` type definitions without removing legacy mode.
2. Update `$.class(macroClass)` runtime execution to support the two-phase flow.
3. Update `MacroClassRefType` so staged classes infer constructor args from `build(self)`.
4. Make `build(self)` return drive public instance typing.
5. Add regression tests for staged mode and compatibility tests for legacy mode.

Non-goals

- Parsing native TS class fields or methods into IR
- Making ordinary class syntax itself be the macro source of truth
- Removing the existing `$.class(...)` primitive

Bottom line

This is a moderate refactor, not a rewrite.

The current codebase already has the right primitives:

- yielded class members
- `ClassMemberRef`
- constructor extraction from yield types
- public shape extraction from generator returns

The missing piece is mostly orchestration:

- let `MacroClass` support a staged definition
- run `impl` and `build(self)` as two linked generator passes
- stop using manual `ctor/public` metadata when the refs can drive the result directly
