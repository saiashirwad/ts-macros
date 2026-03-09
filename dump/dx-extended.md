# DX + trust features wishlist

- Inline expansion peek: command/hover shows expanded code beside the macro call via watcher
  output + source maps; builds trust fast.
- Macro-time type errors: surface `tsc` diagnostics mapped back to the macro call site with
  jump-to-generated fragment.
- Traceable temps: stable, human-friendly temp names (e.g. `__m_user_id_count`) linked to
  originating macro frame in diagnostics.
- Rich macro logs: structured logging with source locations (`$.log.debug("shape", value)`),
  collapsible per macro invocation.
- Deterministic formatting: format generated code (Prettier/TS printer) and skip writes when
  unchanged to calm the TS server.
- Schema-aware helpers: bridges for Zod/Prisma/OpenAPI/GraphQL producing typed DSL nodes directly
  (`$.fromZod(schema)`, etc.).
- Template diffing: snapshot tests for macros (input → generated → diff) to catch regressions on
  upgrades.
- Perf guardrails: time/CPU budgets per macro invocation, graceful timeouts, optional worker pool
  for parallel expansion.
- Playground: web or VS Code webview to edit macros and view live expanded output + types; shareable
  via link/gist.
- DX affordances: `.as<T>()` quick-fix hints, `$.assertType<T>(expr)` fast failures, `$.todo("msg")`
  compile-time error stubs.
- Packageable macros: publish macro packs with declared capabilities (fs/network), versioned DSL
  surface; consumers pin/audit.
- Telemetry (opt-in): counts of `unknown` fallbacks, expansion times, top error kinds to guide
  inference investment.
- Docs in-editor: JSDoc with short examples per DSL call plus snippets for common patterns (class,
  enum, import/export, conditionals).
- Upgrade paths: codemods for DSL breaking changes and a `doctor` command to flag anti-patterns
  (unsafe `raw`, missing `.as`, etc.).
