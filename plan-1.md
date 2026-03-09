# Main `src/` Cleanup Plan

## Summary

- Execute the cleanup in three passes: boundary correctness first, shared internals second, DSL
  surface simplification third.
- Preserve the public DSL surface unless behavior is currently wrong; fix wrong behavior by
  tightening contracts and throwing explicit errors instead of silently coercing unsupported shapes.
- Do not add new language features in this pass. The goal is to make `main` smaller, more honest,
  and easier to understand.
- Keep a short list of explicit second-phase follow-ups: program-scoped state, IR tightening for
  computed/raw/undefined shapes, and splitting oversized modules by concern.

## Implementation Changes

### 1. Boundary correctness in IR and Babel

- Add `typeParams?: string[]` to `"function"` statements in `src/ir.ts` and have `$.function` /
  `$.async` populate it from existing options.
- Change unnamed `"function"` statement lowering in `src/babel.ts` from `arrowFunctionExpression` to
  `functionExpression`, and preserve `async` plus return type annotations in both named and unnamed
  branches.
- Keep class `typeParameters` as the IR shape and wire them through lowering fully; generic classes
  must emit with their type params intact.
- Keep `implements` on classes restricted to `reference` and `generic` type descriptors during
  lowering. For any other descriptor, throw a descriptive error. Do not synthesize fallback output
  like `unknown<...>`.
- Introduce explicit declaration subsets in `src/ir.ts` and use them in three places:
- `export-named.declaration`: allow only `let`, `const`, `function`, `class`, `enum`, `type-alias`,
  `interface`.
- `export-default.declaration`: allow only `Expression`, `function`, `class`.
- `declare.declaration`: allow only `let`, `const`, `function`, `class`, `enum`, `type-alias`,
  `interface`, `namespace`.
- In `src/babel.ts`, reject any declaration node outside those contracts with a thrown error instead
  of a cast.
- Add exhaustive failure paths to the descriptor, expression, and statement lowering switches so
  IR/lowering drift fails loudly.
- Keep property/class keys identifier-only in this cleanup pass. If a non-identifier key reaches
  lowering, throw a descriptive error instead of adding computed/string-key support.
- Keep accepting legacy string type annotations only at public edges for compatibility, but either
  normalize them to descriptors before lowering or make `parseTypeString()` honest about the
  primitives it claims to support. At minimum, do not silently misparse `undefined`, `never`, or
  `unknown` as references.
- Treat `raw` / `raw-stmt` as unsafe legacy escape hatches in the current shape. In this pass,
  prefer narrowing or explicit rejection over pretending arbitrary raw code is a valid identifier.

### 2. Shared normalization and inference

- Make `normalizeToExpression()` in `src/infer.ts` the single value-to-expression coercion entry
  point used by DSL builders and by `ClassRef.new()` in `src/refs.ts`.
- Add one matching internal type-normalization helper (`toTypeDesc()` / `normalizeTypeInput()`) for
  `TypeRef | TSTypeDescriptor | string` so DSL code does not keep branching on type-input shapes by
  hand.
- Replace hand-written normalization branches in `src/dsl.ts` with small internal helpers that
  delegate to that shared normalizer.
- Specifically route `$.template`, `$.return`, class property initializers, enum initializers, and
  other statement/expression helpers through the shared normalizer so booleans, arrays, objects,
  branded expressions, and falsy literals are handled consistently.
- Expand that normalization pass across the helpers that still hand-roll coercion today, especially
  array/object builders, call/new helpers, optional-call variants, assignment, switch, and throw
  paths.
- Ensure `$.object()` and related nested builders recursively normalize plain object/array inputs
  into object/array IR rather than accidentally treating them like already-valid expression nodes.
- Treat `undefined` as unsupported for now. Change `normalizeToExpression(undefined)` to throw a
  descriptive error. Do not expand `LiteralExpression` or add a new IR node in this cleanup pass.
- Preserve literal precision end to end where the IR is already literal-shaped. Update runtime
  inference so string/number/boolean/null literals return literal descriptors instead of widening
  immediately to primitives.
- Collapse parameter/type extraction in `src/types.ts` onto one canonical extractor built on the
  existing descriptor extraction path. Remove `SimpleExtract` and the hard-coded five-parameter
  ceiling.
- Update `InferTSType` so object properties preserve wrapped descriptor metadata such as `optional`
  and `readonly` instead of degrading to `Record<string, unknown>` when the property shape is not a
  bare `TSTypeDescriptor`.
- Consolidate descriptor resolution behind one explicit helper shared by `infer.ts` and `types.ts`;
  remove the current ad hoc `resolved` and property-wrapper unwrapping via `as any`.
- Improve return-type inference so function-like builders account for explicit yielded
  `$.return(...)` statements inside block bodies instead of only looking at the generator’s final
  returned value.
- Tighten arrow/function block return inference in `infer.ts` so it does not stop at the first
  return statement when multiple return paths exist.

### 3. DSL surface simplification

- Extract one internal callable-builder helper in `src/dsl.ts` and reuse it from `$.function`,
  `$.async`, and `$.classMethod`.
- Make that shared helper own param normalization, local variable type patching, generator
  return-to-`return` conversion, inferred return type resolution, explicit-return scanning, and
  `typeParams` propagation.
- Use the shared helper to eliminate the current drift where `$.async` does not follow the same
  param-normalization path as `$.function`.
- Fix `$.classMethod` so the returned `ref` type matches the emitted positional-parameter method
  shape instead of advertising a single object-argument function.
- Keep both optional-chaining APIs public for compatibility, but reimplement the namespaced versions
  as thin wrappers over the direct versions so only one logic path remains.
- Keep the currently tested external `$.class` entry points, but simplify internals:
- Remove dead derived state that is never emitted.
- Split member collection from descriptor synthesis into separate private helpers.
- Keep only the behaviors already covered by tests as the supported contract for this pass.
- Either wire class-shape inference through the existing class/type registries and emitted members,
  or intentionally keep class instances opaque and remove the half-built inference scaffolding. Do
  not leave misleading partial state around.
- Fix falsy initializer handling in `$.classProperty` and `$.enum` so `0`, `false`, and `""` are
  emitted and inferred instead of being dropped by truthiness checks.
- Update `TypeRef.toBabel()` so referenced type arguments are preserved when converting type
  references to Babel nodes.
- Do not rename or remove public DSL helpers in this cleanup pass. If a surface feels redundant,
  collapse it internally first and leave any deprecation decision for a later pass.

### 4. State and architecture follow-up

- Keep the first pass compatible with the current global registries, but treat `typeAliasRegistry` /
  `classRegistry` as a tracked follow-up cleanup target.
- Plan a second-phase move toward a program-scoped build context so tests and multi-file compilation
  do not depend on mutable module-level maps.

### 5. Later-phase IR and module cleanup

- Revisit the IR once the first cleanup wave lands:
- `spread` should likely be modeled as a positional element rather than a free-standing generic
  `Expression`.
- `member` access likely wants an explicit `computed` flag instead of overloading property names and
  inference heuristics.
- `undefined` should become an explicit expression form if the DSL needs to support it honestly.
- `raw` / `raw-stmt` should either be removed, severely narrowed, or backed by a real
  parser/template node instead of `identifier(...)` emission.
- Split oversized files by concern while preserving the public surface:
- `dsl.ts` into expressions/statements/declarations/functions/classes
- `babel.ts` into expression/statement/type lowering
- `types.ts` into compile-time/runtime descriptor utilities

## Test Plan

- Add unit coverage for generic class emission and class `implements` validation.
- Add unit coverage for named and unnamed function statements, including `async`, return
  annotations, and function type params.
- Add unit coverage for invalid `export-named`, `export-default`, and `declare` declarations
  throwing descriptive errors.
- Add unit coverage for `normalizeToExpression(undefined)` throwing.
- Add unit coverage for literal inference preserving `"foo"`, `1`, `true`, `null`, and literal
  object-key/indexed-access cases.
- Add unit coverage for object property descriptors preserving optional and readonly metadata
  through `InferTSType`.
- Add unit coverage for nested object/array normalization in `$.object()`, `$.array()`, `$.call()`,
  `$.new()`, `$.throw()`, and other helpers that previously hand-rolled coercion.
- Add unit coverage for 6+ parameter functions and for object/tuple/generic parameter extraction so
  the old `unknown` fallback cannot regress silently.
- Add unit coverage showing `$.function`, `$.async`, and `$.classMethod` share the same param
  normalization and return inference behavior.
- Add unit coverage showing explicit yielded `$.return(...)` statements participate in final
  return-type inference for function-like builders.
- Add unit coverage showing `$.classMethod().ref` has the same callable shape as the emitted method
  parameters.
- Add unit coverage showing both optional-chaining spellings generate identical output through the
  same underlying path.
- Add unit coverage for `$.template` boolean interpolation and `$.return` with object/array values.
- Add unit coverage for falsy initializers in `$.classProperty` and `$.enum`, covering `0`, `false`,
  and `""`.
- Add unit coverage for `TypeRef.toBabel()` with type arguments.
- If legacy string annotations remain, add unit coverage for `undefined`, `never`, and `unknown`
  being parsed or normalized correctly rather than falling through as references.
- Prefer DSL-level tests over hand-built branded IR or `as any` whenever a public helper can express
  the scenario.
- Run `bun test` and `bun tsc --noEmit` after the refactor. If non-`src` playground/example files
  still fail independently, record that separately and do not widen this cleanup pass to fix them.

## Assumptions and Defaults

- This plan is a cleanup/refactor pass, not a compiler-feature expansion pass.
- Public DSL names and supported test-covered call patterns remain stable.
- Unsupported shapes should fail fast with clear errors rather than being coerced into approximate
  output.
- `undefined` is intentionally rejected for now to keep the cleanup small and honest.
- Non-identifier property keys, full raw-code parsing, broader class/TS surface additions, and the
  IR/module split are explicitly out of scope for the first cleanup pass even though they remain
  valid follow-up work.
