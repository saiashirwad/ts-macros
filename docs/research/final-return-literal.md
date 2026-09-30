# Keeping a plain final return literal

Research for [#33](https://github.com/saiashirwad/ts-macros/issues/33), in [map #32](https://github.com/saiashirwad/ts-macros/issues/32). Tested 2026-10-01 at repository revision `85324afafc4cea18157394bf2ed45640f71be5cf`, with **TypeScript 7.0.2**, using the repository's strict `tsconfig.json`.

## Decision

**For `Decl.fn`, change only its type parameter `Final = unknown` to `const Final = unknown`.** Leave `FnSpec`, `ImplReturn`, all checks, and the generator body syntax alone. This passes strict equality for the required `grade` denotation `(b: boolean) => "A" | "B"`, while a single `return "A"` still denotes `() => string`. The existing tests, including the inference wrapper, continue to pass. No constraint on `Final` is necessary. [R1, R2, experiment below]

**For the planned object-form `Expr.arrow`, the same const parameter preserves literals, but it does not by itself solve the separate check/inference cycle.** A checked-result signature like `Decl.fn` works; keeping the existing `CheckLift<Final>` rest argument does not work for the parameter-dependent `grade` body in the probes. Moving that check to the result preserves rejection of invalid values *as expressions*, but changes whether an unused invalid constructor call itself reports a diagnostic. If “no check gets looser” includes that diagnostic, do **not** adopt that arrow signature as-is: it is the closest checked approach established here, not a complete solution satisfying that stronger requirement. No impossibility theorem is claimed. [R3, experiments below]

This is a research-only commit. The signature modifications were temporary experiments and are not applied to the library.

## Why the one-word change works

`FnSpec` carries `Final` in the generator's return slot. The inference policy belongs on the **generic function that receives the inline callback**, `Decl.fn`; it is not necessary to change the interface. With `const Final`, the inline final value remains `"B"` when inferred through that slot. `ImplReturn` then receives `Lift<"B"> | ReturnValue<Yields>`, rather than `Lift<string> | ReturnValue<Yields>`. The existing `WidenReturn` keeps the two-member literal union, but widens a lone fresh literal. Thus preserving the stage-1 literal is not the same as declaring the stage-2 function to return a single literal. [R1, R2]

TypeScript documents const type parameters as const-like inference, without requiring callers to write `as const`; it also explicitly warns that previously widened values cannot be recovered by this feature. The specific generator behavior here is verified on 7.0.2 by the strict assertions below, not inferred merely from those general docs. [T1]

No runtime or emission change is needed: materialization already lifts the actual final value, and the target emits a plain `return "B";`. Function return annotations are emitted only when explicitly supplied; arrow bodies are emitted as blocks. [R3, R4] This agrees with the earlier [inference-divergence research](https://github.com/saiashirwad/ts-macros/blob/research/inference-divergence/docs/research/inference-divergence.md): the information loss is in stage-1 inference, not nested-return traversal.

### Exact proposed declaration edit

In `src/declaration.ts`, in **`export const fn = <...>` only**:

```diff
   Yields extends NonLoopStatement = NonLoopStatement,
-  Final = unknown,
+  const Final = unknown,
```

Retain the existing parameter type, `FnResult`, and implementation unchanged. In particular retain:

- `Guard<CheckParams<Params>>` and `Guard<Type.CheckTypeParamNames<TypeParams>>`;
- `CheckLift`, the early-return and final-return checks inside `FnResult`;
- `NoInfer<Declared>` so body inference cannot relax an explicit return declaration. [R1]

`tests/inference.test.ts`'s wrapper still compiles unchanged, including generic instantiation, dependent constraints, and forward references. Its comment about intersecting a successful spec with `[]` is stale for this revision: `Guard<[]>` is `unknown` in `src/check.ts`. A wrapper that itself infers `Final` without `const` can still lose raw literal information before forwarding explicit type arguments; update that wrapper's own `Final` to `const Final` if it is used to test this new raw-value guarantee. The successful direct-public-API probe does not use the wrapper. [R5, R6]

## Reproduction: declaration and unchanged stage-2 types

Apply the one-word edit above, save this at the repository root, and run `npx tsc --noEmit`. These are equality tests, not assignability tests. The negative cases assert the exact error result, because an error tuple is itself iterable: merely writing `yield* badResult` outside `Program.build` is not a reliable negative assertion. [R1]

```ts
import { Decl, Expr, Program, Stmt, Type } from "./src/index.ts"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T

Program.build(function* () {
  const grade = yield* Decl.fn("grade", {
    params: [Expr.param("b", Type.boolean)],
    body: function* ({ b }) {
      yield* Stmt.if_(b, function* () { yield* Stmt.return_("A") })
      return "B"
    },
  })
  type Grade = Check<Equal<Expr.Denotes<typeof grade>,
    (b: boolean) => "A" | "B">>

  const single = yield* Decl.fn("single", {
    body: function* () { return "A" },
  })
  type Single = Check<Equal<Expr.Denotes<typeof single>, () => string>>

  const declared = yield* Decl.fn("declared", {
    returns: Type.string, body: function* () { return "A" },
  })
  type Declared = Check<Equal<Expr.Denotes<typeof declared>, () => string>>

  const badFinal = Decl.fn("badFinal", {
    returns: Type.number, body: function* () { return "A" },
  })
  type BadFinal = Check<Equal<typeof badFinal,
    ["the returned value", "A", "is not assignable to", number]>>
  const badEarly = Decl.fn("badEarly", {
    returns: Type.number,
    body: function* () { yield* Stmt.return_("A"); return 1 },
  })
  type BadEarly = Check<Equal<typeof badEarly,
    ["early returns", "A", "do not satisfy the declared return type", number]>>
  const badLift = Decl.fn("badLift", {
    body: function* () { return () => 1 },
  })
  type BadLift = Check<Equal<typeof badLift, ["cannot lift", () => 1]>>
  return grade
})

function stage2(b: boolean) { if (b) return "A"; return "B" }
function stage2Single() { return "A" }
type Actual = Check<Equal<ReturnType<typeof stage2>, "A" | "B">>
type ActualSingle = Check<Equal<ReturnType<typeof stage2Single>, string>>
```

Removing `const` again makes `Grade` fail (and changes the negative final-return error payload from `"A"` to `string`). This is a useful control: the success is caused by the signature change, not by an assertion or annotation in the body.

## Arrow: working inference, and the remaining diagnostic distinction

The current checkout exposes `Expr.arrow(params, body)`, not yet the object API selected in [#25](https://github.com/saiashirwad/ts-macros/issues/25). Its trailing `CheckLift<Final>` check and a context-sensitive callback interfere with inference. Merely adding `const Final` still produced “Expected 4 arguments, but got 2” for a positional `grade`. Giving the type parameters defaults, or putting `NoInfer<Final>` inside that check, did not fix the tested case. An object-form spec with a trailing `CheckLift<F>` likewise failed (“Expected 3 arguments, but got 1”); intersecting `Guard<CheckLift<F>>` into the spec inferred `F` as `unknown` and failed. [R3; checked experiments]

This object-form **signature-only prototype** passed the same strict literal-union and lone-literal assertions. It shares the relevant portion of `FnSpec` and defers the lift check into the result, like `FnResult`. It deliberately excludes `returns` and `typeParams`, rather than silently accepting fields the arrow implementation does not honor:

```ts
import type { Guard } from "./src/check.ts"
import type { WidenReturn } from "./src/typing.ts"

declare function arrow<
  const P extends Expr.AnyParams = [],
  Y extends Stmt.NonLoopStatement = Stmt.NonLoopStatement,
  const F = unknown,
>(
  spec: Pick<Decl.FnSpec<P, unknown, [], Y, F>, "params" | "body">
    & Guard<Expr.CheckParams<P>>,
): Expr.CheckLift<F> extends []
  ? Expr.Arrow<P, WidenReturn<Expr.Lift<F> | Stmt.ReturnValue<Y>>>
  : Expr.CheckLift<F>

const gradeArrow = arrow({
  params: [Expr.param("b", Type.boolean)],
  body: function* ({ b }) {
    yield* Stmt.if_(b, function* () { yield* Stmt.return_("A") })
    return "B"
  },
})
type ArrowGrade = Check<Equal<Expr.Denotes<typeof gradeArrow>,
  (b: boolean) => "A" | "B">>
const singleArrow = arrow({ params: [], body: function* () { return "A" } })
type ArrowSingle = Check<Equal<Expr.Denotes<typeof singleArrow>, () => string>>
const badArrow = arrow({ params: [], body: function* () { return () => 1 } })
type BadArrow = Check<Equal<typeof badArrow, ["cannot lift", () => 1]>>
// @ts-expect-error an error result cannot be called as a stage-2 expression
Expr.call(badArrow)
// @ts-expect-error a required parameter cannot follow an optional one
arrow({ params: [Expr.optional("x", Type.string), Expr.param("y", Type.string)],
  body: function* () { return "A" } })
```

This prototype has no runtime implementation and is compile-only. **It is not a recommendation to remove an argument check without replacement.** The invalid arrow still has an error result rather than an `Expr`, and cannot be used with `Expr.call`; however, the standalone construction of `badArrow` is permitted. Under the brief's strict “no check gets looser” condition, that difference must remain visible in the decision, rather than presenting this as a fully validated drop-in arrow replacement. A future arrow implementation must either preserve call-site rejection while resolving inference, or explicitly obtain a decision permitting the existing `Decl.fn` checked-result convention for arrows. This research did not establish a signature with both properties.

## Validation and limits

- `bun install` installed TypeScript 7.0.2; `npx tsc --version` confirmed it.
- With the one-word `Decl.fn` change, the combined declaration/object-arrow prototype and negative checks above passed `npx tsc --noEmit` under the full repository configuration.
- The existing test sources, including their `@ts-expect-error` checks and the unchanged inference wrapper, passed the same typecheck.
- `node --test`: **131 passed, 0 failed** during the experiment. Type-parameter modifiers erase at runtime; no implementation/emitter behavior was changed.
- Reverting `Decl.fn`'s const modifier made the expected strict assertions fail. Temporary source modifications and probe files were removed after investigation.

Not established: exact denotations for all compound returns, mixed freshness, any/unknown, previously widened callbacks, or all wrapper shapes. Const inference does not repair information already widened before the call [T1], nor the unrelated approximation gaps in `WidenReturn` identified by #29. A literal-preserving constraint was not needed for `Decl.fn`, so no broad constraint redesign is proposed. The arrow check-placement problem is **not proven impossible**; the checked-result prototype is the closest approach tested here.

## Primary sources

- [R1] [`FnSpec`, `ImplReturn`, `FnResult`, `Decl.fn`](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/src/declaration.ts#L175-L242).
- [R2] [`ConstType`, `WidenFresh`, `WidenReturn`, runtime return inference](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/src/typing.ts#L18-L166).
- [R3] [`Lift`/`CheckLift`](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/src/expr.ts#L41-L79) and [`Arrow`, materialization, current arrow signature](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/src/expr.ts#L553-L576).
- [R4] [Actual function/arrow/return emission](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/targets/typescript/index.ts#L160-L180).
- [R5] [Inference wrapper and its test cases](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/tests/inference.test.ts).
- [R6] [`Guard` success is `unknown`](https://github.com/saiashirwad/ts-macros/blob/85324afafc4cea18157394bf2ed45640f71be5cf/src/check.ts#L1-L10).
- [T1] [Microsoft: const type parameters, TypeScript 5.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters). The release notes establish the general feature and its limits; the 7.0.2 compiler runs above are the primary evidence for these particular signatures.
