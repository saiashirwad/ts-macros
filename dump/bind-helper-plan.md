# Plan: object-binding helper for `let`/`const`

Goal: add ergonomic `$.bind` helpers so callers can emit multiple declarations without repeating
names, returning VarRefs shaped like the input object.

- API surface
  - `$.bind(values, kind = "const")` generator.
  - Convenience shorthands: `$.bind.const(values)`, `$.bind.let(values)`.
  - Support value forms: plain value | `VarRef` | `TypeRef` | `{ value, tsType?, kind? }` to allow
    per-entry overrides and explicit types.

- Typing
  - Generic `T extends Record<string, unknown>`; return type
    `{ [K in keyof T]: VarRef<InferValueType<ValueOf<T[K]>>> }`.
  - `ValueOf` handles wrapper object form (picks `value`) and preserves literal types when
    `as const` is used.
  - Accept `TSTypeDescriptor | TypeRef` for `tsType`; inferred when absent.

- Implementation (src/dsl.ts)
  1. Add internal helper to iterate `Object.entries(values)` in insertion order.
  2. For each entry, normalize input to `value/tsType/kind`, infer descriptor when missing, build
     `Statement` with name = key, kind-specific type, and push `VarRef` into result object.
  3. Return the result map; keep emitted names exactly the object keys.
  4. Add shorthands `bind.const` / `bind.let` that call the main helper with fixed kind.
  5. Export through `src/index.ts`.

- Tests (src/index.test.ts)
  - Generates const bindings: expect code contains `const count = 0` and `const name = "Alice"`.
  - Generates let bindings when using `bind.let`.
  - Mixed override: `{ foo: { value: 1, kind: "let" } }` emits let; others const.
  - Type behavior: returned `VarRef` types align with input (literals preserved with `as const`;
    `TypeRef` respected).
  - Destructuring rename: `const { count: cnt } = yield* $.bind({ count: 0 });` still emits
    `const count`.

- Docs
  - Update README or add a short snippet in existing DX notes showing the new pattern vs. old
    string-based calls.
