# DX affordances to add

- `$.assertType<T>(expr)`: macro-time check that the inferred/phantom type matches `T`; fails fast with a clear message.
- Quick-fix hints when inference yields `unknown` (suggest `.as<T>()` in the error/log output).
- `$.todo("message")` / `$.fail("message")`: emit typed compile-time stubs that surface unfinished branches to consumers.
- Structured `$.log.debug/info` with source locations, so tracing macro execution is readable and tied to the call site.
- Skip-write formatting: generate prettified output and only touch files when content changes to reduce TS server churn.
