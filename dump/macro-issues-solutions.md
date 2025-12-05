# Macro DX gaps and mitigations

- Hygiene: scoped name allocator + `$.gensym(prefix)`; all binders use allocator to avoid collisions with macro temps.
- Import/export clobbering: central map in babel translation; alpha-rename conflicts with short hash suffix (e.g. `Foo__m1`).
- Structural safety: `validate(ir)` pass pre-emit to catch unbound vars, duplicate bindings, invalid break/continue, missing returns in non-void functions.
- Stronger assurance: optional `generateAndTypecheck(..., { strict })` that runs `ts.transpileModule` (fast) or `ts.createProgram` (slow) on a temp file.
- Explicit escape hatches: unsafe builders require `.as<T>()` or `tsType`; surface as `Unsafe<T>` phantom so reviewers can grep.
- Phase clarity: keep IR pure; world reads go through `$.effect(() => ...)` to mark phase boundaries.
- Testing: property-test IR→Babel→reparse roundtrip; snapshot macro expansions; corpus `tsc --noEmit` on generated fixtures in CI.
- Inference telemetry: count `unknown` fallbacks to target inference work without hiding unsoundness.
- Editor DX: ship `ts-macros.d.ts` overloads that mirror narrowed inference (optional chaining → `T | undefined`, etc.).
