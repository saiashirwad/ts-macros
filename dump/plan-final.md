# ts-macros – coherent delivery plan

## Scope & goal
- Ship a typed macro system for TypeScript where `.macro.ts` files expand to real `.generated.ts` code with source-mapped diagnostics and strong editor DX.
- Cover full TS surface for codegen (IR/Babel) while keeping inference to a practical, sound subset (unknown over wrong).
- Authoring time must feel “extreme inference”: DSL APIs are fully typed so bad combos (e.g., `sum(VarRef<boolean>)`) surface as red squiggles in the macro file, not only after generation.

## Operating model
- Two modes per export:
  - **Derive mode (parsed, not executed):** declarative chains like `derive(User).extend(...).omit(...)` → MacroOp → transform types.
  - **Generator mode (sandboxed execution):** imperative `function*` / `$.block` that yields IR statements.
- Hybrid files allowed; each export is classified independently.

## Deliverables
- **IR/Babel parity:** add remaining expressions/statements/types (conditional, mapped, optional chaining, classes/enums, imports/exports, etc.).
- **DSL coverage:** ergonomic builders for new IR plus inference where practical; escape hatches via `.as()`.
- **Refs/types:** `ClassRef`, `EnumRef`, inference helpers for class/enum shapes.
- **Hygiene + validation:** scoped name allocator and structural validator (unbound vars, duplicate bindings, invalid break/return, void vs return paths).
- **Source maps:** macro-location → generated-location mapping for both derive and generator outputs.
- **Watcher/CLI:** `ts-macros watch` and `ts-macros build` with debounce, cache busting, sandbox, incremental writes, optional `--tsc-check`.

## Pipeline (v1)
1) **Parse** `.macro.ts` AST → classify exports → build `MacroOp[]` (derive steps, block ops) with `loc`.
2) **Type extraction** (read-only TS Program) for derive ops; expose `$.extractType` in generator sandbox.
3) **Transform**: apply derive chains to extracted types; run generator exports in sandbox vm; collect IR.
4) **Codegen**: IR → Babel AST → code + `.map`; format; hash-compare to skip unchanged writes.
5) **Output**: write `.generated.ts` (+ banner) and `.map`; optional `.d.ts` twin; respect tsconfig include/exclude.

## Safety & perf
- Sandbox generator mode (vm/worker) with module allowlist, time/CPU budget, cache-busted imports; no network/process exit.
- Name allocator prevents temp/user collisions; derive-mode rejects dynamic constructs (computed keys, ternaries, non-top-level chains).
- Incremental writes and batching to reduce TS server churn; optional worker pool for large macro sets.

## DX essentials
- Expansion peek: show generated snippet + mapped diagnostics from source maps.
- Deterministic formatting; skip-write when unchanged.
- Quick-fix hints when inference returns `unknown`; `$.assertType<T>()`, `$.todo()/$.fail()` stubs.
- Structured logging with source locations for generator mode.

## Testing
- Unit tests for IR ↔ Babel translation and new DSL builders.
- Roundtrip property tests: IR → Babel → reparse.
- Snapshot tests for representative macros (derive and generator).
- Optional `tsc --noEmit` corpus on generated fixtures in CI.

## Decisions
- Derive combinators: allow `extend/omit/pick/partial/required/merge/record`; only static keys/values, no computed props.
- Generated artifacts: gitignore by default; offer opt-in flag (e.g., `--emit-checked`) to keep `.generated.ts*` for CI/release reproducibility.
- Sandbox defaults: allowlist `fs`, `path`, `url`, optional `crypto`; block `net/child_process`; freeze globals; forbid `process.exit` and env writes; ~2s timeout per export (configurable); queue work one worker per file change.
- Source maps: emit `.map` by default; keep `--no-source-maps` escape hatch. Maps wire TS errors/go-to-definition back to `.macro.ts` lines.
