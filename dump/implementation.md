# ts-macros – implementation checklist

## Core invariants
- Emit vs infer: IR/Babel can emit full TS; inference only on practical subset; prefer `unknown` over wrong, `.as<T>()` as escape hatch.
- “Extreme inference” for authoring: DSL/derive helpers must be fully typed so incompatible uses surface as TS errors in `.macro.ts` (e.g., calling `sum` expecting numbers with a `VarRef<boolean>` squiggles immediately).
- Two modes per export: derive (parsed-only) and generator (sandboxed execution); classify per export, hybrid files allowed.
- Hygiene/validation: scoped name allocator for all binders/temps; structural validator pre-emit (unbound vars, duplicate bindings, bad break/return, await-in-non-async, imports/exports top-level).

## File-by-file tasks
- `src/ir.ts`: add missing expressions/statements/types (conditional, spread/new/this/arrow, optional chaining/nullish, update, tagged template, destructuring; class/enum/switch/try/while/do-while/throw/break/continue/import/export/namespace; advanced types: conditional/mapped/keyof/typeof/indexed-access/template-literal/infer/index-signature/readonly).
- `src/babel.ts`: 1:1 mapping for all new IR nodes; ensure source location threading for maps.
- `src/dsl.ts`: builders for new constructs; inference where practical; `.as`, `.satisfies`, `.nonNull`, optional call/member, nullish, ternary, arrow, class/enum/import/export helpers, control flow; support ClassRef/EnumRef returns.
- `src/refs.ts`: add `ClassRef`, `EnumRef` (typed phantom); update exports.
- `src/types.ts`: inference helpers for class members and enum shapes; keep “unknown over wrong”.
- `src/infer.ts` (if needed): normalize/descriptors for new nodes.

## Macro compiler (watch/build)
- CLI: `ts-macros watch` (debounce, hash compare skip-write, banner), `ts-macros build`, optional `--tsc-check`, `--no-source-maps`, `--emit-checked`.
- Sandbox generator mode: vm/worker, allowlist `fs/path/url/crypto`, block `net/child_process`, forbid `process.exit`/env writes; ~2s timeout/export; cache-busted imports; one worker per file change; optional pool.
- Derive mode parse rules: top-level exports only; combinators `extend/omit/pick/partial/required/merge/record`; static keys/values only; reject computed/ternary/dynamic dispatch.
- Type extraction: TS Program (incremental) to read source types; expose `$.extractType` in sandbox.
- Outputs: `.generated.ts` (+ banner) and `.generated.ts.map` by default; gitignore default, opt-in keep via flag; stay within `rootDir`; include generated files in tsconfig, exclude `.macro.ts` from emit.

## Source maps
- Always emit maps by default; macro-loc → generated-loc; carry `loc` on MacroOp and IR; verify TS server diagnostics jump to `.macro.ts`.

## DX features to wire early
- Expansion peek using generated + maps.
- Quick-fix hint when inference returns `unknown`; `$.assertType<T>()`, `$.todo()/$.fail()` stubs.
- Structured logging with source locations in generator mode.
- Deterministic formatting (Prettier/TS printer) and skip-write to reduce LS churn.

## Testing
- Unit tests: IR↔Babel new cases; DSL builder shape/inference.
- Roundtrip property tests: IR → Babel → reparse.
- Snapshots: representative derive + generator macros.
- Optional corpus `tsc --noEmit` over generated fixtures.
