# Phase 1 plan — IR/Babel surface completion

Goal: extend the IR and Babel translation to cover missing TS constructs so later phases (hygiene, watcher, source maps) can build on a complete codegen surface.

Reference context
- `dump/ts-macros-complete-ts-plan.md` (full surface/gaps list)
- `dump/plan-final.md` and `dump/plan-final-detailed.md` (scoped goals/decisions)
- `dump/implementation.md` (checklist)

Deliverables
- `src/ir.ts`: add missing expression/statement/type variants (ternary, optional chaining/nullish, spread/new/this/arrow, as/satisfies/non-null, update, tagged template, destructuring, assignment; class/enum/switch/try/while/do-while/throw/break/continue; import/export/namespace; advanced TS types: conditional/mapped/keyof/typeof/indexed access/template literal/infer/index signature/readonly).
- `src/babel.ts`: 1:1 mappings for all new IR nodes, threading source locations for future maps.
- `src/dsl.ts`: minimal builders to exercise new IR nodes (no inference polish yet—just parity so tests compile).
- Tests: add/extend unit snapshots for IR→Babel on new nodes; ensure existing suite passes.

Steps
1) Enumerate and add IR types for missing expressions/statements/types (keep branded Expr check intact).
2) Implement Babel translators for each new IR node; ensure operators/flags align with Babel TS nodes.
3) Add minimal DSL entry points that brand/normalize inputs for the new IR nodes (enough to build fixtures/tests).
4) Create fixtures + snapshot/unit tests covering representative cases for each new construct.
5) Run test suite; fix fallout.

Out-of-scope (later phases)
- Hygiene allocator, structural validator, watcher/CLI, source maps, “extreme” inference polish, DX affordances.

Test plan
- `npm test` (or current test command) after additions.
- Add targeted snapshot/unit tests for new IR→Babel translations.
