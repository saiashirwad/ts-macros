Objective

Collapse `ClassRef` from two public type parameters to one while preserving typed constructor arguments and typed instance/public surfaces.

Context & invariants

- `ClassRef` currently carries two separate type-level concepts:
  - instance/public shape
  - constructor signature
- Runtime `ClassRef` still needs two descriptors:
  - `instanceTsType` for the result of `new`
  - `ctorTsType` for the variable/callee type
- `$.new(...)` must continue to infer:
  - constructor args from the class ref
  - instance/public shape as the result
- `$.class(...)` must continue to derive public instance shape from:
  1. returned refs
  2. `instanceType`
  3. synthesized public members
- Existing ergonomics like `ClassRef<PersonPublic>` should ideally keep working, even if we stop exposing a second generic.

Architecture

Data structures / types

- Introduce a normalization helper for the single `ClassRef` generic:

```ts
type AnyCtor = (...args: any[]) => any;

type NormalizeClassCtor<T> =
  T extends AnyCtor ? T : (...args: any[]) => T;

type ClassInstance<T> = ReturnType<NormalizeClassCtor<T>>;
type ClassParams<T> = Parameters<NormalizeClassCtor<T>>;
```

- Redefine `ClassRef` around one public generic:

```ts
class ClassRef<T = unknown> extends VarRef<NormalizeClassCtor<T>> {
  new(...args: ClassParams<T>): TypedExpression<ClassInstance<T>> { ... }
}
```

- Meaning of `ClassRef<T>` after the refactor:
  - if `T` is an object/public shape, `ClassRef<T>` means “a class producing `T` with unknown constructor args”
  - if `T` is a function type, `ClassRef<T>` means “a class whose constructor signature is exactly `T`”

- This preserves the useful shorthand:
  - `ClassRef<PersonPublic>`
- And unlocks the less redundant inferred form:
  - `ClassRef<(label: string, score: number) => ScoreBoardPublic>`

Public interface changes

- `$.class(name, body)` should return:

```ts
ClassRef<ClassConstructorOutFromBody<BodyFactory, ClassInstanceOutFromBody<...>>>
```

- `$.class(name, options)` should return:

```ts
ClassRef<(...args: any[]) => ClassInstanceType<InstanceAnnot, Implements>>
```

- Utility extraction should move away from `ClassRef<infer I, infer Ctor>` patterns.
- Add exported helpers for readability in tests and downstream code:

```ts
type ClassInstanceOf<C> =
  C extends ClassRef<infer T> ? ClassInstance<T> : never;

type ClassConstructorOf<C> =
  C extends ClassRef<infer T> ? NormalizeClassCtor<T> : never;
```

- This lets users write:

```ts
type ScoreBoardCtor = ClassConstructorOf<typeof ScoreBoard>;
type ScoreBoardPublic = ClassInstanceOf<typeof ScoreBoard>;
```

File structure

- `src/refs.ts`
  - replace dual-generic `ClassRef<Instance, Ctor>` with single-generic `ClassRef<T>`
  - add local helper types or import shared ones
- `src/types.ts`
  - export `NormalizeClassCtor`, `ClassInstanceOf`, `ClassConstructorOf` (or similarly named helpers)
- `src/dsl.ts`
  - update `CreateClass` overloads to return single-generic `ClassRef`
  - update `$.new(...)` conditional typing to extract params/return via the new helpers
- `src/index.test.ts`
  - update old `ClassRef<Instance, Ctor>` assertions
  - add coverage for both supported single-generic forms:
    - `ClassRef<PersonPublic>`
    - `ClassRef<(id: number) => PersonPublic>`

Recommended approach

- Prefer the normalized single-generic design over a pure constructor-only `ClassRef<Ctor>`.

Rationale:

- A pure constructor-only design is technically possible:
  - `ClassRef<Ctor extends (...args: any[]) => any>`
  - use `Parameters<Ctor>` and `ReturnType<Ctor>`
- But it would break the existing and useful shorthand `ClassRef<PersonPublic>`.
- The normalized single-generic design removes the duplicated public generic while keeping that shorthand intact.

Implementation steps

1. Add the new helper types in `src/types.ts`.
2. Update `src/refs.ts` so `ClassRef` uses one generic and derives `VarRef`/`.new(...)` types from helpers.
3. Update `src/dsl.ts` overloads and `$.new(...)` extraction logic to use the new helpers.
4. Replace `ClassRef<infer I, any>` and `ClassRef<any, infer Ctor>` usage with `ClassInstanceOf<...>` / `ClassConstructorOf<...>`.
5. Update tests that explicitly mention the old two-parameter form.
6. Add regression tests for:
   - inferred class return type from `$.class(...)`
   - `Parameters<ClassConstructorOf<typeof ScoreBoard>>`
   - `ReturnType<ClassConstructorOf<typeof ScoreBoard>>`
   - `ClassRef<PersonPublic>` remaining usable as a shorthand
   - `new ClassRef<(id: number) => { id: number }>("Box")` preserving typed args

Verification strategy

- Run `bun test`
- Run `bun tsc --noEmit`
- Confirm these type expectations still hold:
  - `$.new(ScoreBoard, ["tasks", 2])` returns the public instance shape
  - `$.new(ScoreBoard, [])` remains a type error when constructor params are known
  - helper extraction from `typeof ScoreBoard` works through `Parameters<>` and `ReturnType<>`
- Confirm branded-expression runtime behavior remains unchanged for `ClassRef.new(...)`

Migration notes

- Most internal breakage will be type-level only.
- Runtime behavior should remain unchanged because `instanceTsType` and `ctorTsType` still exist as fields.
- If preserving downstream compatibility matters, a temporary compatibility alias can be added in docs/examples, but it is probably not needed inside this repo.
