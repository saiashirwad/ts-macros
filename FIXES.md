# FIXES — what landed here, why, and what is left for you

Repo state: `core-simplify` = your code (11ef014) + one base fix (2957397) + four merged
fix branches (`991cf1e` merge fix/core, `e641a56` merge fix/guards, `3c01136` merge fix/cuda,
`8c40278` merge fix/diff). Branches `fix/core`, `fix/guards`, `fix/cuda`, `fix/diff` are kept
for reference. Nothing was pushed anywhere; your repo is untouched.

Per-area detail for hand-merging: `FIXES-core.md`, `FIXES-guards.md`, `FIXES-cuda.md`,
`FIXES-diff.md` — each has per-fix before/after code, the why, and any API change.

Gate after merging everything: `bun test` = **139 pass / 12 files** (was 114 / 9),
`tsc --noEmit` clean, `dprint check` clean, the DSA test still compiles with cc and runs.

## What landed

### 1. `In<void>` — void impls typecheck (src/norm.ts)

`In<A> = [A] extends [void] ? A | Expr.Expr<A> | Surface<A> | Liftable<A> : ...`
Why: falling-off-the-end bodies (`function*() {}`) are valid impls; without this arm,
void functions and CUDA kernels cannot be written (verified failing under tsc before,
passing after). `materializeValue` already skips the implicit return.

### 2. fix/core — three surgical dedups (FIXES-core.md)

- `ConstWiden<A> = A extends string | number | boolean ? A : Widen<A>` — identical
  semantics across all 6 cases; reuses `Widen` instead of re-listing 5 of its clauses.
- Object-literal fields widen during synthesis (`{a: 1}` now synthesizes `{a: number}`
  like the type level says; runtime `widen` agrees with type-level `Widen`).
- `mapType` functor extracted; `substituteType` = mapType + param lookup (~45 → ~7 lines),
  with the boundary comment: it is the emit-time shadow of the type-level `Substitute`,
  needed only after phantoms erase.

### 3. fix/guards — six runtime/emit guards (FIXES-guards.md)

- Throwing `Symbol.toPrimitive` on `Prototype` (Yieldable inherits it): `x > 3` on an
  any-typed node used to silently produce `false` and get baked in as a literal; now it
  throws and names the sugar (add, sub, gt, ...).
- `proxied(node, get, apply)` shared by `expr` and `texpr`; both proxy get-traps turn
  `Symbol.toPrimitive`/`toString`/`valueOf` into the staging thrower (was bun's useless
  "No default value").
- `makeEmit` dispatch rejects non-nodes with "a surface proxy leaked into the IR
  (norm() it first)" before handler lookup.
- Text target `ident` uses babel's `isValidIdentifier`: `const delete` now throws;
  text and babel targets agree.
- `collectImports` throws when two sources map to one local name, listing both.
- 12 new tests in src/runtime-guards.test.ts.

### 4. fix/cuda — c-family kit, ownership free policy, CUDA target (FIXES-cuda.md)

- `targets/c-family/`: shared spelling kit (ident, `===`→`==` precedence, declare, param,
  ifChain, scalar oracle, binding declaration) + a `cFamily(fail)` base target. C target
  211 → **74** lines of pure policy.
- Handler-map types (`ExprHandlers`/`StatementHandlers`/`TypeHandlers`) exported from
  src/emit/index.ts (additive; the kit needs them to `Omit` per-target keys).
- Ownership free policy: `Owned<T, Free extends string = "free">`, `owned(t, free?)`,
  `insertFrees(statements, types, free?)` — default behavior byte-identical (all existing
  ownership tests pass unchanged); device pointers use `cudaFree`, host memory `free`.
- `targets/cuda/` (201 lines of policy): void kernels (`kernel()` is now an honest void
  phantom — In<void> makes it typecheck), `<<<grid,block>>>` launch piggyback,
  `__shared__`, `f32`, and `Ptr<T>` out-params: `cudaMalloc(&d_a, n)` — the address-of
  lie is gone. `examples/examples-cuda.ts` emits a full vector-add; the test pins the
  source. No core nodes added.
- Known (documented): no nvcc here, so the .cu is source-pinned, not compiled;
  cudaError_t returns ignored; int where size_t is expected.

### 5. fix/diff — cross-target differential suite (FIXES-diff.md)

- 8 seeds in examples/diff/ + targets/c/diff.test.ts: one Program → TS run under bun vs
  C compiled with `cc -std=c11 -Wall -Werror` and run; byte-compares stdout + exit code,
  LCS diff on failure.
- Pins precedence, all comparisons, `&&`/`||`/`!`, if/elseif/else, while, calls, early
  returns, recursion, break/continue, param reassignment.
- Two adaptations worth knowing: C driver prints with `%g` (numbers render as double in
  C; `%d` would be UB), TS child runs with `FORCE_COLOR=0` (bun colorizes console.log).

## What I deliberately did NOT do — needs your thought

1. **Lazy bodies** (the big one). Live evidence from fix-diff: the fib seed needed a
   name-based `$.Value` workaround because a self-call inside the impl hits TDZ — the
   body materializes eagerly at yield, before the ref const exists. Fixing this unblocks
   mutual recursion, C monomorphization, and CUDA `__device__` generics. Shape: keep the
   impl factory on the declaration, materialize per distinct type-arg tuple (memoized);
   `substituteType` (now mapType-based) is the runtime substitute. Your call: specialize
   eagerly at each Instantiation, or a collect-then-specialize prepass.
2. **`Int`'s home / semantic numeric types.** Still leaks: emitting an `int()`-annotated
   program through the TS target prints `function f(x: Int): Int`. Options: a shared
   module (src/types/numeric.ts) with per-target spelling tables (`I32` → `number`/`int`),
   or keep nominals per-target. CUDA correctness later needs widths (f32) and the
   number→double-vs-float default question.
3. **Program-level artifacts.** CUDA includes are hardcoded strings; body-less functions
   throw in every emitter, so prototypes/mutual recursion are unexpressible; host/device
   split has no home. Sketch: an optional `program` hook on `Target`.
4. **`walk.ts` hardening.** walk treats ANY object with a string `tag` as a node (user
   data with a `tag` key gets visited by analyses) and has no cycle guard (a circular
   lifted object stack-overflows it). Fix options: brand check (but `Param` nodes are
   unbranded), or a known-tag set. Needs a node-shape decision, so I left it.
5. **Name hygiene leftovers**: C-family reserved words (`delete` is legal C, illegal in
   C++/CUDA — decide when CUDA is compile-verified), C prototype hoisting (ties to 3),
   object-key integer reorder + `__proto__` (existing comment in emit/typescript.ts).
6. **Layout calls**: `std/` still in src/std/, tests still at src/ level, `play.ts` dead,
   README is 12 bytes (staging rule unnamed), no src/core.ts entry. All trivial, all yours.
7. **Kept as-is on purpose**: both emitters (text.ts is load-bearing for synthesize;
   babel = formatting contract + AST), the 8 pipe overloads (measured: a variadic fold
   loses per-stage inference), `Denote`/`TDenote` separate (type-confusion guard),
   launch + Ptr stay piggybacks (rule-of-two: a third use triggers a core node), no
   address-of core node.
8. **Semantics gaps the diff suite documents** (its growth list): division (TS `/` vs C
   int truncation), strings, modulo, arrays, mutual recursion.
9. **Horizon (sketched in earlier reports, not implemented)**: autodiff as a build-time
   IR pass, Rust target from the parameterized ownership pass, WGSL as the semantics
   acid test, per-target semantics conformance matrix.

## Merge order for your repo

1. `In<void>` (one line + comment, src/norm.ts)
2. FIXES-core.md → 3. FIXES-guards.md → 4. FIXES-cuda.md → 5. FIXES-diff.md
   (area scopes do not overlap; each doc lists its commits in order)

After merging: `bun test` should show 139, `tsc --noEmit` clean, `dprint check` clean.
