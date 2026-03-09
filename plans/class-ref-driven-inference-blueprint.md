Objective

Make class member definitions first-class typed refs so the same source of truth powers:
- authoring-time `self` / `this` inference inside `$.classMethod(...)`
- reusable type derivation for other APIs and helper functions
- the resulting `ClassRef<Instance>` public surface
- runtime code generation

Context & Invariants

- Existing class generation and emitted TypeScript must keep working.
- `$.classProperty(...)` and `$.classMethod(...)` should stay usable as yielded class members.
- `VarRef<T>` / `TypeRef<T>` remain the main user-facing phantom-typed building blocks.
- Unknown is still preferred over wrong when inference truly cannot be proven.
- The current generator-based DSL style should remain intact.

Concrete Problems To Solve

1. `self` inside `$.classMethod(...)` is typed from `options.thisType`, not from the enclosing class shape.
   - Relevant code: `src/dsl.ts` `classMethod`, `AnnotationToType`, `FinalizeClassMember`.
2. Yielded class members currently help runtime synthesis, but their type data is not exposed as a reusable first-class schema.
3. `$.class(...)` has two separate notions of shape:
   - synthesized member descriptors for internal `this`
   - returned refs / `instanceType` for the external `ClassRef`
   These drift apart.
4. Generic helpers such as `$.methodCall(...)` are brittle because they rely on late conditional inference over unresolved method/property types.

Architecture

Data Structures / Types

1. Introduce a specialized class-member ref type.

   Proposed shape:

   ```ts
   type ClassMemberMeta = {
     key: string;
     memberKind: "property" | "method" | "getter" | "setter" | "constructor";
     accessibility?: "public" | "private" | "protected";
     static?: boolean;
     tsType?: TSTypeDescriptor;
   };

   class ClassMemberRef<T = unknown> extends VarRef<T> {
     declare readonly __classMember: true;
     constructor(name: string, public meta: ClassMemberMeta) {
       super(name, meta.tsType);
     }
   }
   ```

   Notes:
   - `ClassMemberRef<T>` should be assignable to `VarRef<T>` so existing helper patterns keep working.
   - Both `$.classProperty(...)` and `$.classMethod(...)` return `ClassMemberRef<T>` instead of plain `VarRef<T>`.
   - Getter refs remain property-shaped. Method refs remain callable-shaped. Constructors should not participate in instance shape derivation.

2. Add a type-descriptor builder that derives object shapes from refs.

   Proposed surface:

   ```ts
   type.fromRefs(...)
   ```

   Examples:

   ```ts
   const name = yield* $.classProperty("name", ...);
   const score = yield* $.classProperty("score", ...);
   const bump = yield* $.classMethod("bump", ..., { returnType: type.number() });

   const internalShape = type.fromRefs({ name, score, bump });
   const publicShape = type.fromRefs({ bump }, { visibility: "public" });
   ```

   Expected behavior:
   - For plain `VarRef<T>`, use `ref.tsType` if available, otherwise `unknown`.
   - For `ClassMemberRef<T>`, use `meta` to preserve getter/property distinction and visibility filtering.
   - Returned type is a `TypedDescriptor<...>` so it can flow through `InferTSType`.

3. Separate internal-instance shape from public-instance shape, but derive both from the same refs.

   Proposed internal helpers:

   ```ts
   type ShapeFromRefs<R, Mode>
   ```

   Modes:
   - `internal`: include instance properties, methods, getters, setters; exclude constructors and static members
   - `public`: same as internal, but only `public` members (or members without explicit private/protected accessibility)

   This keeps a single ref graph while allowing `self` and `ClassRef` to intentionally differ.

Public Interface Changes

1. `$.classProperty(...)` returns `ClassMemberRef<T>` instead of `VarRef<T>`.
2. `$.classMethod(...)` returns `ClassMemberRef<T>` instead of `VarRef<T>`.
3. Add `type.fromRefs(refMap, options?)`.
4. Keep `thisType` and `instanceType`, but let them accept the result of `type.fromRefs(...)`.
5. Do not require new syntax immediately. The ergonomic goal is:
   - explicit ref-derived shapes are possible today
   - automatic class synthesis internally reuses the same machinery

How `self` Should Work

Phase 1: explicit-but-first-class

- Users can assign member refs to variables.
- Users can derive a `thisType` descriptor from those refs.
- `$.classMethod(..., { thisType: internalShape })` gives a strongly typed `self`.

Example:

```ts
const label = yield* $.classProperty("label", { typeAnnotation: type.string(), accessibility: "private" });
const score = yield* $.classProperty("score", { typeAnnotation: type.number(), accessibility: "private" });

const internalShape = type.fromRefs({ label, score });

yield* $.classMethod(
  "bump",
  {},
  function* (_args, self) {
    return numeric.add($.prop(self, "score"), 1);
  },
  { thisType: internalShape, returnType: type.number(), accessibility: "public" }
);
```

This removes the “magic self” problem because `self` is typed from an explicit reusable descriptor built from first-class refs.

Phase 2: automatic-by-default

- `$.class(...)` should internally compute the same `internalShape` from yielded member refs.
- When `$.classMethod(...)` omits `thisType`, finalization and compile-time typing should both use the enclosing class’s internal shape.
- This likely requires threading a class-body type context through class member creation, not just runtime descriptor finalization.

Recommended implementation approach for phase 2:
- add an internal class-body context object in `$.class(...)`
- as members are yielded, register their `ClassMemberRef` metadata
- compute one canonical internal descriptor from that registry
- use that descriptor both for runtime `ctx.variables.set("this", ...)` and for the `ClassMemberRef` / method-body type pathway

Important note:
- the current `$.classMethod(...)` generic cannot infer `self` from ambient outer state on its own; TypeScript needs a value/type input it can see.
- so phase 2 may require an internal builder API or a contextual helper passed through the class body.
- if that proves too invasive, phase 1 is still valuable and unlocks reusable schemas immediately.

How `ClassRef<Instance>` Should Work

Recommended rule:

- External `ClassRef<Instance>` should be driven by explicit public exposure.

Priority order:

1. If the class body returns refs, public instance shape comes from those returned refs.
2. Else if `instanceType` is provided, public instance shape comes from `instanceType`.
3. Else derive public instance shape from yielded public `ClassMemberRef`s.

Rationale:
- returned refs are the clearest, least surprising contract
- `instanceType` remains the manual escape hatch
- fallback public-member synthesis improves ergonomics without exposing private fields

Rules:
- constructors never appear in public instance shape
- getters become properties
- setters contribute property type only if paired with a getter or explicit annotation
- static members do not appear in instance shape
- private/protected members do not appear in public instance shape

File Structure

- `src/refs.ts`
  - add `ClassMemberRef`
- `src/types.ts`
  - add `ShapeFromRefs` / extraction helpers for `type.fromRefs`
- `src/dsl.ts`
  - return `ClassMemberRef` from `classProperty` / `classMethod`
  - add `type.fromRefs` export surface
  - refactor class member collection to derive internal/public descriptors from ref metadata
- `src/infer.ts`
  - ensure descriptors built from refs resolve cleanly through `InferTSType`
  - likely strengthen method/property descriptor inference paths used by `$.prop`, `$.methodCall`, and `$.new`
- `src/index.test.ts`
  - add type-only and runtime coverage for explicit ref-derived `thisType`, returned public refs, fallback public synthesis, and helper reuse

Implementation Steps

1. Add `ClassMemberRef<T>` in `src/refs.ts`.
   - Keep assignable to `VarRef<T>`.
   - Preserve getter vs method metadata.

2. Update `$.classProperty(...)` and `$.classMethod(...)` in `src/dsl.ts` to return `ClassMemberRef<T>`.
   - Populate metadata consistently.
   - Keep emitted IR unchanged.

3. Add `type.fromRefs(...)`.
   - Support plain `VarRef`s and `ClassMemberRef`s.
   - Add visibility/static filtering.
   - Preserve property vs callable member shape.

4. Refactor `$.class(...)` member synthesis to use `ClassMemberRef` metadata rather than reconstructing shape from raw `ClassMember`.
   - derive canonical internal descriptor
   - derive canonical public descriptor

5. Wire `ClassRef<Instance>` priority:
   - returned refs
   - explicit `instanceType`
   - public synthesized descriptor

6. Improve `self` typing.
   - Phase 1: make explicit `thisType: type.fromRefs(...)` work everywhere.
   - Phase 2: thread enclosing class internal shape into method body typing when `thisType` is omitted.

7. Revisit helper APIs that consume callable properties.
   - `$.methodCall(...)`
   - `$.optionalCall(...)`
   - possibly `$.prop(...)`
   so ref-derived method types survive generic wrappers.

Verification Strategy

Type-only checks

- `show(...)` / `expectTypeOf(...)` for:
  - class property refs assigned to variables and reused elsewhere
  - class method refs assigned to variables and passed into helpers
  - `type.fromRefs({ ... })` producing correct object shapes
  - `self` typed from explicit `thisType: type.fromRefs(...)`
  - `ClassRef<Instance>` from returned public refs
  - fallback `ClassRef<Instance>` from yielded public members
  - getters becoming properties, methods staying callable
  - private members excluded from public shape

Runtime checks

- generate and execute a simple class like `ScoreBoard`
  - constructor assignment
  - method mutation and return values
  - helper-based method calls on `$.new(...)` instances

Regression checks

- the existing `Person` getter example
- `class.ts`
- `bun test`
- `bun tsc --noEmit --pretty false` excluding known unrelated failures

Open Questions

1. Do we want phase 2 automatic `self` inference now, or do we ship phase 1 explicit ref-derived `thisType` first?
2. Should returned refs continue to be required for public shape, or should yielded public members become the default when nothing is returned?
3. Do we want a single `type.fromRefs(...)` helper, or separate helpers for `internal` / `public` class shape derivation?
