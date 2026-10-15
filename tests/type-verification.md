# Type verification

Use Node 24 and install dependencies with `pnpm install --frozen-lockfile`.

- `pnpm verify` runs type checking, degradation controls, runtime tests, lint, and formatting. `pnpm test` alone does not check type assertions.
- `pnpm types:controls` requires each language-rule rejection in `lang.test.ts` to disappear when its specific mistake is removed. Failed fixtures remain at the printed path.
- `pnpm test` compiles the TypeScript programs that `typescript.test.ts` emits with `tsc`. Each one carries `Equal` checks that the emitted types compute what the builder's types computed.
