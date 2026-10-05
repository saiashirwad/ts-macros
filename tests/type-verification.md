# Type verification contracts

`pnpm verify` runs a cold compiler check, deliberate type-degradation controls, sequential runtime tests, real TypeScript language-server checks, lint, and formatting. The PR workflow runs the same command with Node 24, pnpm 11.13.0, and frozen dependencies. TypeScript is pinned at 7.0.2. Editor snapshots need an explicit review when that version changes.

The commands run sequentially because emitted-code tests start their own compilers. `pnpm test` alone does not validate `@ts-expect-error` directives or exact type assertions.

Node 24 runs the verification tools and their CLI regression tests directly as erasable TypeScript. The repository's strict `tsconfig.json` includes the tools and CLI regression tests through its default TypeScript file discovery. Probes, editor observations, pending LSP requests, compiler diagnostics, and cost samples have explicit types. External JSON and LSP responses retain runtime validation before use.

## Consumer and emitted-code contracts

`consumer-contract.test.ts` asserts saved branded identifiers, recursive trees, fresh literals, mutable unions, and the final numeric result with `Equal`. It also requires invalid inputs to produce compiler errors. Exact assertions accompany consumer operations because `any` can satisfy parameter checks and `never` is assignable to every type.

`pnpm types:controls` compiles an unchanged temporary fixture, then five degraded copies. Replacing either saved identifier or tree input with `FFI.Value<any>` or `FFI.Value<never>` must produce TS2344 at the corresponding exact assertion and TS2322 at its exact-value assignment. Replacing the identifier brand with `string` must produce only TS2578 at the unused branded rejection directive. The complete diagnostic set must match the expected files, anchored lines, and codes. A compiler crash, stale seed, timeout, or additional diagnostic fails the command. Failed sources remain in the printed temporary directory for inspection.

`consumer-emission.ts` covers branded values, recursion, literals, mutable unions, numeric expressions, objects, and generic arrow instantiation. `emittedTypecheck` compares each stage-1 denotation with unchanged emitted TypeScript in another module. This preserves declaration inference rather than substituting hand-written annotations or use-site narrowing. Existing `exactness.ts` and `equality.ts` retain their broader compiler-backed contracts and explicit diagnostic exceptions.

## Editor contracts

`pnpm editor:check` opens the valid `editor-contract.ts` corpus through the installed compiler's native LSP over stdio. It requires zero diagnostics and checks the finite probes in `tools/editor-contracts.ts`.

The probes cover branded, recursive, literal, union, object, numeric result, and generic-call hovers. The object denotation expands to `label: string` and `count: number`. The object reference currently displays the `ObjectExprFields` helper. The snapshot records that limitation without changing public types to satisfy the test.

Signature help requires a recursive tree argument and the correct active parameter. Member completions require useful expression and program members. Contextual completions check an object key and both union literals through the declared denotation. These probes establish those positions only. In this compiler, the generic `Stmt.assign` string argument suggests its inferred current literal rather than the full union. Completion ranking, completion-item documentation, and physical editor rendering remain outside these checks.

Every value hover has targeted semantic requirements and a bounded length. Empty output, toxic saved types, and truncation fail before snapshot comparison. The command also changes savedTree to `any` in the open LSP document, requires the captured hover to fail the normal validator, and restores the original document. Additional controls reject `never`, truncation, and excessive display growth.

`pnpm editor:update` writes `editor-contract.snapshot.json` after the same semantic and degradation checks pass. Review the full snapshot diff before accepting display changes. Updating cannot approve an empty response or a degraded saved type. The snapshot normalizes line endings and outer whitespace, sorts completion labels, and preserves type and signature spelling.

These checks verify actual language-server responses. They do not verify VS Code's renderer, extension configuration, or UI truncation.

## Cold compiler cost reports

`pnpm typecheck:metrics --output .cache/typecheck/head.json` records five sequential cold compilations. Each compiler process disables incremental and composite state and must finish successfully with nonzero type-checking work. Reports contain raw diagnostics, elapsed process time, compiler times, types, instantiations, memory, machine details, load averages, revision, source provenance, compiler flags, normalized configuration, dependency lock hash, and the compiler's file manifest. Summaries contain medians and ranges.

To alternate head and base samples, run the following command after installing frozen dependencies in both checkouts:

```sh
pnpm typecheck:metrics --baseline-cwd /path/to/base --baseline-output .cache/typecheck/base.json --output .cache/typecheck/head.json
```

To compare recorded runs, use the following command:

```sh
pnpm typecheck:metrics --compare .cache/typecheck/base.json .cache/typecheck/head.json --report .cache/typecheck/comparison.md
```

The comparison first parses each sample's raw compiler output and requires the saved metrics and summary to agree with it. This detects inconsistent records; it does not authenticate edited raw output. Elapsed process time and machine observations are separately recorded values.

The comparison requires matching compiler, Node version, machine, flags, configuration, file manifest, and dependency lock. Changed source contents remain comparable and are recorded by hash. A new fixture, compiler upgrade, or changed dependency set produces an explicit incomparable report. CI uploads both raw records and writes the comparison to its job summary.

Timing and memory deltas are observations. Their causes need separate investigation. This workflow does not claim a speedup or gate a PR on one timing threshold. Changes to the corpus establish a new workload baseline.
