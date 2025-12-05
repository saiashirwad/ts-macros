# ts-macros – detailed delivery plan

## Scope & goal
- Typed macros for TS: `.macro.ts` → `.generated.ts` with mapped diagnostics and solid DX.
- Full codegen surface (IR/Babel) with conservative inference (unknown over wrong) and explicit escape hatches.

## Operating model (per export)
- **Derive mode (parsed, not executed):** declarative chains `derive(T).extend().omit().pick().partial().required().merge().record()`. Rules: top-level only; static keys/values; no computed props or dynamic dispatch.
- **Generator mode (sandboxed execution):** imperative `function*` / `$.block` yielding IR; can call `$.extractType`.
- Hybrid files allowed; each export classified independently. Unknown patterns → clear error.

## IR / DSL / Types
- Extend IR to cover missing TS constructs (conditional, mapped, optional chaining, nullish, ternary, classes, enums, imports/exports, advanced types).
- Babel mapper: 1:1 cases for all new IR nodes.
- DSL: builders for new nodes; inference where practical; `.as()` escape hatch; add `ClassRef`, `EnumRef` and shape inference for members/enums.

## Hygiene & validation
- Scoped name allocator for binders/temps; auto alpha-rename on collision.
- Structural validator pre-emit: unbound vars, duplicate bindings, invalid break/continue/return, void vs return paths, await-in-non-async, imports/exports top-level.

## Source maps (why and how)
- Always emit `.map` by default; `--no-source-maps` escape hatch.
- Map generated line/col → `.macro.ts` span for both derive and generator outputs.
- Use loc on MacroOp/IR nodes; verify TS server jumps/diagnostics resolve to macro sites.

## Watcher / CLI
- Commands: `ts-macros watch` (dev) and `ts-macros build` (CI).
- Debounce + hash compare to skip unchanged writes; banner `// @generated`.
- Sandbox for generator exports: vm/worker, allowlist `fs/path/url/crypto`, block `net/child_process`, freeze globals, forbid `process.exit` and env writes; ~2s timeout per export (configurable); one worker per file change queued.
- Cache-busted imports each run; optional worker pool for large macro sets.
- Optional `--tsc-check` to run `tsc --noEmit` on generated outputs.

## Outputs & repo hygiene
- Default gitignore `*.generated.ts*`; flag `--emit-checked` (or config) to keep outputs in VCS for reproducibility.
- Keep outputs inside `rootDir`; tsconfig include `**/*.generated.ts`, exclude `.macro.ts` from emit.

## DX essentials
- Expansion peek: command/hover shows generated snippet + mapped diagnostics.
- Deterministic formatting (Prettier/TS printer); skip-write when identical to calm TS server.
- Quick-fix hints on `unknown` inference; `$.assertType<T>()`, `$.todo()/$.fail()` stubs; structured `$.log.*` with source loc.

## Testing
- Unit tests for new IR ↔ Babel mappings and DSL builders.
- Roundtrip property tests: IR → Babel → reparse equivalence.
- Snapshots for representative derive + generator macros.
- Optional `tsc --noEmit` corpus over generated fixtures in CI.

## Perf & safety notes
- Batch file events; incremental program for type extraction.
- Time/CPU budgets enforced; graceful timeout messaging.
- Reject derive chains with dynamic constructs at parse time.
