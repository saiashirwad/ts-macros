# Comparing denotations with TypeScript inference

Research for [#28](https://github.com/saiashirwad/ts-macros/issues/28), 2026-10-01. Repository baseline: `d4dbe8c3183fc4dad493003e75af0757bff0722a`.

## Decision

Use **one batched `tsc --noEmit` invocation from `node:test`, compiling unmodified stage-2 emission together with type-only imports of stage-1 denotations and strict `Equal` assertions**. This needs no new dependency, uses the installed compiler, and makes a mismatch a normal compiler diagnostic. Do not annotate stage 2 with the expected type, stringify `node.type`, or compare printed type strings as the equality oracle. The snippets below were exercised with Node 24.21.0 and TypeScript 7.0.2. [R1–R5, experiments below]

For binding tests, compare `Expr.Denotes<typeof program.result.someBinding>` with `typeof` the corresponding emitted binding. Test a raw expression separately from a `let`, `const`, or function-return inference rule: these contexts deliberately change fresh literal types. A plain runtime helper taking `Expr<any>` cannot recover its caller's erased denotation; the checked source must retain a concrete stage-1 type via a fixture export. [R2, R3, R6]

For raw-expression types where a binding probe changes the question, use the compiler API to locate the emitted expression itself, rather than silently treating a new `const` as context-free. The API is useful for inspection and richer diagnostics, not printed-string equality. No universal equality relation for arbitrary TypeScript types is established here; adopt the strict predicate below as the test contract, with explicit edge-case controls. [R3, T1]

## Why the existing test is insufficient

`tests/typing.ts` currently rewrites inferred types into annotations and typechecks that altered program. It additionally declares unknown external values as `any`. This checks compatibility under supplied contextual types, not equality with the independently inferred, unchanged stage 2. Its existing `Equal` is bidirectional assignability, which admits distinctions such as `any` versus `number` and mutable versus readonly object properties. Keep that helper only if its weaker contract is intentional. [R4]

`Expr.Denotes<E>` extracts the TypeScript type parameter of `Expr`; `expr.type` is optional runtime data, and externals need not have it. Therefore emitting `expr.type` as the expected side does not test `Expr.Denotes<E>`. [R2]

## Candidates and measured cost

All timings below are local wall-clock observations, not CI budgets. Each fresh check includes compiler startup, repository source imports, and checking their type-level definitions. The shared fixture is one arithmetic expression; all approaches use the repository options, with composite/incremental disabled for isolation. Five repetitions per approach; the first successful run gave:

| Candidate | Time per isolated test | Dependencies | Failure/readability | Verdict |
| --- | --- | --- | --- | --- |
| Emitted `.ts` + strict `Equal`, CLI | 1.61–2.03 s (median 1.68 s) | Installed `typescript`, Node built-ins | TS2344 at the named assertion; append source to assertion failure | Recommended, batch cases |
| Compiler API `typeToString` | 1.51–1.80 s (median 1.61 s), fresh API session with full diagnostics | Installed `typescript/unstable/sync` | Nice printed diff, but it is a presentation comparison | Inspection only |
| Declaration emit + strict `Equal` | 1.68–1.82 s (median 1.80 s), two compiler processes | Installed compiler and disk `.d.ts` files | Same TS2344 plus intermediate declarations | Works, extra moving parts without a benefit here |

A later run under variable machine load was slower: CLI 1.77–2.50 s; API 1.64–2.21 s; declaration roundtrip 2.02–2.84 s. In that run 100 identical assertion sites in one invocation took 2.69–2.80 s, about 27 ms/site amortized. That is **not** a measurement of 100 distinct expression shapes or incremental checker latency. It supports batching, not a precise scaling claim. No persistent-API caching benchmark was done.

The baseline `node --test` passed 131 tests in about 248 ms; its existing emitted-program compiler check was about 52 ms. That check does not import stage-1 source, and uses a different, smaller compiler configuration, so it is not an apples-to-apples speed target for the equality harness. Baseline `npx tsc --noEmit` also passed. [R4, local experiments]

### Important version surprise

The repository declares `typescript: ^7.0.2`; the installed package was 7.0.2. `import('typescript')` exposes a version but **no `createProgram`**. The familiar TypeScript 5.x `ts.createProgram` snippet is not a working candidate here. This package exports the new API under `typescript/unstable/sync` and `/async`. It supplies `API`, snapshots, projects, `checker.getDeclaredTypeOfSymbol`, `getTypeAtPosition`, and `typeToString`. The explicit `unstable` import is another reason not to build the simplest test around it. [R1, T1, T2]

## Minimal working snippets

Put the following shared setup in `denotation-probe.test.mjs` at the repository root, then append **one** candidate test and the cleanup test. Run `node --test denotation-probe.test.mjs`. The temporary directory is beneath the checkout so `../src` and the repository configuration resolve normally. The stage-1 fixture is loaded at runtime to produce stage 2; `tsc` later reads its types without running it. [R5, experiments]

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

const dir = mkdtempSync(resolve('.denotation-'))
const put = (name, text) => {
  const file = join(dir, name)
  writeFileSync(file, text)
  return file
}
const config = put('tsconfig.json', JSON.stringify({
  extends: '../tsconfig.json',
  compilerOptions: {
    composite: false, incremental: false, declaration: false,
  },
  files: ['check.ts'], include: [], exclude: [],
}))
put('fixture.ts', `
import { Decl, Expr, Program } from '../src/index.ts';
export const expression = Expr.add(1, 2);
export const program = Program.build(function* () {
  return yield* Decl.const_('actual', expression);
});
export type Expected = Expr.Denotes<typeof expression>;
`)
const { program } = await import(join(dir, 'fixture.ts'))
const { emitProgram } = await import('./targets/typescript/index.ts')
put('stage2.ts', emitProgram(program) + '\nexport { actual };')
const check = `
import type { Expected } from './fixture.ts';
import { actual } from './stage2.ts';
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Check = Assert<Equal<Expected, typeof actual>>;
`
const checkFile = put('check.ts', check)
function tsc(extra = []) {
  const result = spawnSync(resolve('node_modules/.bin/tsc'),
    ['-p', config, '--pretty', 'false', ...extra], { encoding: 'utf8' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
```

This fixture deliberately uses arithmetic, whose expression and const-binding types are both `number`; it is not an assertion that every expression can be captured without inference changes. For binding probes change `Expected` to `Expr.Denotes<typeof program.result>`. The one-binding fixture has no naming collisions; a production harness must obtain actual emitted names from `bindingNames`, not assume a name hint survives emission. [R2, R3, R5, R6]

### A. CLI + equality (recommended)

```js
test('denotation equals stage-2 inference', () => {
  tsc()
})
```

A negative control replacing `Equal<Expected, typeof actual>` with `Equal<Expected, string>` failed with:

```text
check.ts(...): error TS2344: Type 'false' does not satisfy the constraint 'true'.
```

Use one uniquely named assertion per case and include the relevant emitted source on failure. Add negative controls for `any`/`number`, `never`/`unknown`, readonly/mutable fields, optional/required fields, and literal/widened primitives before trusting the helper. The generic-function predicate above is stronger than mutual assignability, but can distinguish differently represented intersections and object types even when mutually assignable. Do not claim mathematical or universal compiler type identity from it. [R4; predicate supplied above]

### B. Compiler API + printed strings (working, not a reliable equality oracle)

Append this import and test to the shared setup:

```js
import { API } from 'typescript/unstable/sync'

test('inspect both types', () => {
  const api = new API()
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] })
    try {
      const project = snapshot.getProject(config)
      assert.ok(project)
      const p = project.program
      assert.deepEqual([
        ...p.getConfigFileParsingDiagnostics(),
        ...p.getProgramDiagnostics(), ...p.getGlobalDiagnostics(),
        ...p.getSyntacticDiagnostics(), ...p.getSemanticDiagnostics(),
      ], [])
      const c = project.checker
      const symbol = c.getSymbolAtPosition(checkFile, check.lastIndexOf('Expected'))
      assert.ok(symbol)
      const expected = c.getDeclaredTypeOfSymbol(c.getAliasedSymbol(symbol))
      const actual = c.getTypeAtPosition(checkFile, check.lastIndexOf('actual'))
      assert.ok(actual)
      assert.equal(c.typeToString(expected), c.typeToString(actual))
    } finally { snapshot.dispose() }
  } finally { api.close() }
})
```

Both strings were `number`. A first attempt calling `getTypeAtPosition` directly on the imported type alias occurrence produced `any`, despite clean diagnostics; resolving the alias symbol and asking for its declared type fixed the probe. Preserve this distinction when using the API. [local experiment, T1]

This example also checks the shared `Equal` assertion through semantic diagnostics; the string comparison is an additional experiment, not what establishes its reliability. Type printers may retain aliases and depend on display context/flags, while equality is a type-level question. Comparing `type.id`, or asking assignability in both directions, does not provide the intended strict predicate either. For a production API harness, evaluate a synthesized `Equal<Expected, Actual>` alias/constraint and use `typeToString` only to explain failures. For a raw expression, locate its exact AST expression node and query that node, preserving its actual lexical and inference context. [T1; recommendation]

### C. Declaration emit + equality

```js
test('compare through declarations', () => {
  const stageConfig = put('stageconfig.json', JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false, declaration: true,
      emitDeclarationOnly: true, outDir: 'dts',
    },
    files: ['stage2.ts'],
  }))
  tsc(['-p', stageConfig])
  put('check.ts', check.replace(
    "import { actual } from './stage2.ts'",
    "import type { actual } from './dts/stage2.d.ts'",
  ))
  tsc()
})
```

The compiler emitted `declare const actual: number; export { actual };`. The type-only import matters: a normal value import directly from `.d.ts` failed with TS2846. Compare types from the declaration, not its text. This route only observes exported declaration types; local expression sites still need explicit probes, and declaration emit adds another phase and failure surface. [local experiment, T3]

Finally append cleanup (the snippets use serial top-level tests):

```js
test('cleanup', () => rmSync(dir, { recursive: true, force: true }))
```

For a permanent helper use a test cleanup hook/`finally` around fixture creation and compilation, set a process timeout, and keep source/diagnostics in the failure message before deleting files. Batch isolated modules so bindings and externals cannot leak across cases.

## Integration boundaries and remaining uncertainty

1. **Retain actual denotations in source.** Export concrete expressions, or `program.result` references, from stage-1 fixtures. Never supply `Expected` as a handwritten type unrelated to the builder, and never introduce `Expr<any>` annotations that erase it. [R2, R6]
2. **Do not change stage-2 inference.** Use ordinary `emitProgram`, not `emittedSource` from the current helper. No expected annotations, `as const`, `satisfies`, or expected-typed generic wrappers. Preserve annotations that the user actually requested. Distinguish expression, binding, and return probes explicitly. [R3–R5]
3. **Match configuration.** Extend the repo's config rather than the existing helper's smaller CLI flag list. In particular, `noUncheckedIndexedAccess` affects array reads, and `exactOptionalPropertyTypes` affects optional properties. When the intended target config differs, make it a named test dimension instead. [R1, R3, R4]
4. **Resolve binding identity.** For more than the minimal fixture, use the emitter's binding-name allocation. An export added after emission must use the allocated name, and a local binding requires a probe inside its actual scope. Do not move expressions across control-flow narrowing sites. [R5, R7]
5. **Give externals genuine types.** Import their real declarations or use explicit per-fixture ambient contracts; never ambient `any` as a convenience. Invalid emitted code and unresolved externals must fail before comparison. [R2, R4]
6. **Validate the equality predicate.** The stronger predicate and edge controls are the proposed practical contract, not a proof covering all generics, overloads, intersections, conditional types, or recursive types. The working probes cover arithmetic, a deliberately wrong expected type, and declaration transport; full construct coverage remains implementation work.
7. **No production harness change in this ticket.** This resolves the research choice. Persistent API sessions, cross-platform CI timing, broad distinct-case batching, and exact raw-expression probe instrumentation were not benchmarked/implemented.

## Primary sources

Repository links are pinned to the baseline researched (relative paths also work in the checkout):

- **R1:** [package.json](../../package.json), [tsconfig.json](../../tsconfig.json), [pinned configuration](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/tsconfig.json).
- **R2:** [src/expr.ts](../../src/expr.ts), especially `Expr`, `Denotes`, `External`, `ObjectExpr`, `ArrayExpr`; [pinned source](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/expr.ts#L26-L34).
- **R3:** [src/typing.ts](../../src/typing.ts), `WidenFresh`, `ConstType`, `WidenReturn`, `bindingType`; [pinned source](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/typing.ts).
- **R4:** [tests/typing.ts](../../tests/typing.ts), `Equal`, `annotated`, `ambient`, `emittedTypecheck`; [pinned helper](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/tests/typing.ts).
- **R5:** [targets/typescript/index.ts](../../targets/typescript/index.ts), `bindingDeclaration`, `emitProgram`; [pinned emitter](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/targets/typescript/index.ts).
- **R6:** [CONTEXT.md](../../CONTEXT.md), [src/program.ts](../../src/program.ts), [examples/overview.ts](../../examples/overview.ts): vocabulary, result type retention, builder usage.
- **R7:** [src/scope.ts](../../src/scope.ts), `bindingNames`, used directly by the TypeScript target.
- **T1:** Installed first-party `node_modules/typescript/dist/api/sync/api.d.ts`, `API`, `Snapshot`, `Program`, `Checker` declarations; exact-package public copy: [typescript@7.0.2 API declarations](https://unpkg.com/typescript@7.0.2/dist/api/sync/api.d.ts). Also `dist/api/proto.d.ts` for `openProjects`.
- **T2:** Installed first-party `node_modules/typescript/package.json`, version/export map; [exact-package public copy](https://unpkg.com/typescript@7.0.2/package.json). Local `import('typescript')` probe verified `createProgram` is undefined.
- **T3:** TypeScript's [emitDeclarationOnly option](https://www.typescriptlang.org/tsconfig/emitDeclarationOnly.html); behavior independently exercised against the installed 7.0.2 CLI in the snippet above.

The installed package files, rather than assumptions from older compiler API tutorials, are the primary evidence for the version-specific API findings. Timings and diagnostic examples come from local execution of the snippets with five fresh iterations, not documentation promises.
