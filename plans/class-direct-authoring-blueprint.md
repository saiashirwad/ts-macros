Objective

Evaluate whether a real TypeScript `class` can become the authoring surface for the existing
`$.class(...)` DSL, while preserving typed `$.new(...)` and the current IR/codegen behavior.

Context & invariants

- The current class DSL is not just typing sugar. It is also the IR capture mechanism.
- `$.class(...)` executes a generator, collects yielded class members, finalizes method bodies with
  a synthesized `this` type, and only then emits a class statement.
- `$.new(...)` is already strongly typed when the callee is a `ClassRef`.
- The smallest correct change is preferred. Avoid a source-transformer-sized rewrite unless the
  payoff is clearly worth it.

Architecture

Data structures / types

- Keep `ClassRef<T>` as the emitted-class token and constructor/instance type carrier.
- If we want an opaque nominal handle, add an optional "host class token" concept:
  - a user-authored TS class used only for nominal typing and naming
  - a `ClassRef` still produced by the DSL and still used for emission
- Distinguish three concepts explicitly:
  - host class token: user-authored TS class, if any
  - class definition factory: generator that yields class members
  - emitted class ref: `ClassRef<...>` returned by the DSL

Feasibility findings

- Direct field syntax like `label = $.classProperty(...)` inside a real TS class is not enough for
  the current architecture.
- Why:
  - `$.classProperty(...)` currently works by yielding a `ClassMember` out of a generator, not by
    returning a declaration object that TypeScript can later reify.
  - method bodies are currently captured as generator-produced IR statements, not by inspecting
    native class method syntax.
  - the current `$.class(...)` pipeline depends on iterating yielded members and then finalizing
    them against the synthesized `this` shape.
- Therefore:
  - using a literal TS class as the source of truth for emitted syntax is not realistically possible
    without adding a parser/macro/transform step
  - using a literal TS class as a token/container around the existing generator is feasible

Design options

1. Keep current DSL as source of truth

- Continue using:
  - `const ScoreBoard = yield* $.class("ScoreBoard", function* () { ... })`
- Pros:
  - zero architectural mismatch
  - preserves current inference and codegen model
- Cons:
  - no opaque nominal class type unless introduced separately

2. Host class with static define function

- Example shape:

```ts
class ScoreBoard {
  static *[$.defineClass]() {
    const label = yield* $.classProperty("label", type.string())
    const bump = yield* $.classMethod(...)
    return { bump }
  }
}

const ScoreBoardRef = yield* $.class(ScoreBoard)
```

- The real class is only a token/container.
- The static generator remains the actual source of IR.
- `$.class(ScoreBoard)` can derive:
  - emitted name from `ScoreBoard.name`
  - instance type from the host class instance type
  - members/constructor from the yielded DSL body
- Pros:
  - gives an opaque user-facing type name
  - keeps the existing yield-based capture model
  - avoids pretending native class syntax is being captured when it is not
- Cons:
  - slightly more ceremony
  - two things now exist: the host class token and the emitted `ClassRef`

3. Native class syntax as source of truth

- Example shape:

```ts
class ScoreBoard extends SomeMagicalType<?> {

  impl* () {
    const label =yield* $.classProperty("label", type.string())
    const bump = yield* $.classMethod(...)
    ...
    yield* $.constructor(...)

    ... and so on
  }

}
```

- This would require a new mechanism to inspect or transform native class bodies into your IR.
- In practice that means:
  - a custom TS transform
  - Babel/TS parser pass over source text
  - or actual macro support
- Pros:
  - nicest authoring syntax
- Cons:
  - fundamentally different architecture
  - much larger scope than the current request
  - easy to create confusing runtime/type-only hybrids

Recommendation

- Do not pursue option 3 in the current architecture.
- If the goal is mostly opaque typing and nicer referential ergonomics, option 2 is the best fit.
- If the goal is only typed construction, the current `ClassRef` path already solves most of it and
  probably does not justify a host class yet.

Recommended API direction

- Keep `$.class(name, function* () { ... })` as the core primitive.
- Optionally add a host-token overload later:

```ts
class ScoreBoard {
  static *define() {
    const label = yield* $.classProperty("label", type.string())
    const score = yield* $.classProperty("score", type.number())
    yield* $.constructor(
      [$.p("label", type.string()), $.p("score", type.number())] as const,
      function* ({ label, score }) {
        // ...
      },
    )
    const bump = yield* $.classMethod(...)
    return { bump }
  }
}

const ScoreBoardRef = yield* $.class.from(ScoreBoard, ScoreBoard.define)
const scoreBoard = yield* $.let("scoreBoard", $.new(ScoreBoardRef, ["tasks", 2]))
```

- Important:
  - use the host class for nominal typing
  - use `ClassRef` for emission and `$.new(...)`
  - do not try to make the host class itself be emitted from its own native syntax

Implementation steps

1. Decide whether opaque nominal typing is actually needed beyond `ClassRef` + helper types.
2. If yes, prototype a host-token API that accepts a real class constructor plus a DSL body factory.
3. Keep the generator/yield body unchanged so member capture and `this` finalization remain intact.
4. Add tests proving:

- `$.class.from(ScoreBoard, ...)` returns `ClassRef<(...args) => ScoreBoard>`
- `$.new(ScoreBoardRef, ...)` returns `TypedExpression<ScoreBoard>`
- public method refs can still be exported through the returned object

5. Only revisit native-class authoring if you are willing to add a parsing/transform stage.

Verification strategy

- Type-level:
  - verify `ClassInstanceOf<typeof ScoreBoardRef>` equals the host class instance type
  - verify constructor args still flow into `$.new(...)`
- Runtime/codegen:
  - generate the class and confirm method/property syntax is unchanged
  - confirm captured property refs still lower to `this.label`, `this.score`, etc.
