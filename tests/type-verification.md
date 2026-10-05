# Type verification

Use Node 24 and install dependencies with `pnpm install --frozen-lockfile`.

- `pnpm verify` runs type checking, degradation controls, runtime tests, language-server checks, lint, and formatting. `pnpm test` alone does not check type assertions.
- `pnpm types:controls` requires the expected diagnostics from deliberately degraded consumer types. Failed fixtures remain at the printed path.
- `pnpm editor:check` checks hovers, signatures, and completions against semantic requirements and `editor-contract.snapshot.json`. Actual output is saved to `.cache/editor-actual.json`.
- `pnpm editor:update` runs the same checks before replacing the snapshot. Review its diff, including after a TypeScript upgrade. These checks cover language-server responses, not editor rendering.

## Compiler cost

Collect five cold samples:

```sh
pnpm typecheck:metrics --output .cache/typecheck/head.json
```

To alternate base and head samples, install frozen dependencies in both checkouts, then run:

```sh
pnpm typecheck:metrics --baseline-cwd /path/to/base --baseline-output .cache/typecheck/base.json --output .cache/typecheck/head.json
pnpm typecheck:metrics --compare .cache/typecheck/base.json .cache/typecheck/head.json --report .cache/typecheck/comparison.md
```

Reports include raw compiler output, medians, and ranges. Comparison rejects inconsistent metrics and summaries. Different tooling, machine, configuration, file manifest, or dependencies make reports incomparable. Timing is observational and does not gate CI. CI uploads the reports and adds the comparison to its job summary.
