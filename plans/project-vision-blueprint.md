## Objective

Preserve the project's core idea while narrowing the next implementation pass to the smallest set of "hard parts" worth rebuilding by hand for understanding.

## Context & Invariants

- The core architecture is already coherent: DSL authoring -> branded IR -> Babel code generation.
- The project goal is not just code generation; it is typed authoring with useful inference during macro construction.
- `brand()` and `isExpr()` are important invariants for separating IR expressions from plain objects.
- "Unknown over wrong" is the right inference philosophy and should remain in place.
- `bun test` currently passes for the library surface.
- `bun tsc --noEmit` currently fails in top-level example/playground files, so library health and repo-wide typecheck health are not identical today.

## Architecture

### Data structures / types

- Keep the three-layer model:
  - `src/dsl.ts` for ergonomic authoring and typed refs
  - `src/ir.ts` for explicit, serializable, branded nodes
  - `src/babel.ts` for deterministic lowering to Babel AST/code
- Treat `src/infer.ts` as a support layer, not the architectural center.
- Keep phantom-typed refs (`VarRef`, `TypeRef`, `ClassRef`) because they are the main bridge between authoring ergonomics and static types.

### Public interface changes

- Avoid public API expansion until the minimal core feels solid.
- Prefer temporarily freezing new DSL surface area over continuing to add constructs everywhere.

### File structure

- Keep existing core files.
- Add small internal docs/tests as needed.
- Avoid introducing new layers until the current ones are tighter.

## Assessment

The project vision makes sense. The strongest idea here is:

Author TypeScript-like code through a typed DSL, preserve enough structure in an IR to reason about it, then lower it cleanly to generated `.ts` output.

What looks unstable is not the vision. It is the current ambition level. The repo is trying to do three hard things at once:

- design a pleasant macro DSL
- model a broad TypeScript/Babel surface area
- infer useful types across that surface

That combination makes the code feel rewrite-worthy even when the foundation is valid.

## Recommended direction

Do not fully rewrite the project from scratch.

Instead, do a focused "core re-derivation" by hand:

1. Freeze the feature surface.
2. Rebuild only the minimal spine in a branch or parallel scratch area:
   - literals
   - variables
   - arrays/objects
   - member access
   - calls
   - `const`/`let`
   - functions
   - type aliases
3. Re-implement those pieces yourself end-to-end:
   - DSL builder
   - IR node
   - Babel lowering
   - inference rule
   - test
4. Once that feels obvious, reintroduce advanced constructs one family at a time.

## Implementation steps

1. Define a "core kernel" checklist of features that must work before anything advanced returns.
2. Mark all advanced features as secondary layers:
   - optional chaining
   - nullish
   - `new`
   - classes/enums
   - imports/exports/namespaces
   - advanced TS type descriptors
3. For each core feature, verify the full path:
   - authoring input
   - normalized expression
   - branded IR
   - inferred type
   - Babel emission
   - generated code assertion
4. Only after the kernel feels easy, re-add one advanced feature family at a time.
5. Separate repo verification into:
   - core library tests
   - playground/example typechecks

## Verification strategy

- Keep `bun test` green after every small step.
- Add targeted tests that prove one feature through the full DSL -> IR -> Babel path.
- Run `bun tsc --noEmit` for the library and examples, but report them separately until examples are cleaned up.
- Avoid claiming inference support for a construct until a test demonstrates it.

## Practical guidance

If your real goal is understanding, the best move is not deleting this repo. The best move is choosing a tiny subset and forcing yourself to rebuild that subset cleanly without leaning on the already-written abstractions too much.

That gives you:

- understanding of the hard parts
- a stable reference implementation to compare against
- less risk of losing useful work
- a much clearer sense of which parts are genuinely overengineered
