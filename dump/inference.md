# Inference gaps and fixes (aiming for “extreme inference” — squiggles for bad combos at authoring time)

1) `inferExpressionType` too loose
- Gaps: returns `any` for call/member/await; arrays use only first element; objects don’t union differing field types; null/undefined fall through; many operators unresolved.
- Fix: add cases for null/undefined; infer arrays from all elements (union or common supertype); objects union field types; tighten unary/binary cases; prefer `unknown` over `any` for unknown shapes.

2) Function type erasure
- Gap: `InferTSType` for `{kind:"function"}` collapses params to `(...args: InferTSType<P[number]>[])`, losing arity/order.
- Fix: build tuple-preserving function type: `(...args: InferParamTuple<P>) => InferTSType<R>` with `InferParamTuple` mapped over params.

3) DSL builders typed as `any`
- Gaps: `ternary/nullish/optionalProp/optionalCall/new/spread/as/satisfies/methodCall/arrow/assign/taggedTemplate` accept `any` and return generic `T`.
- Fix: add generics + constrained inputs (e.g., `optionalProp<TObj, K extends keyof TObj>` → `TypedExpression<TObj[K] | undefined>`), constrain test operands, and return precise unions.

4) `$.function` loses parameter types
- Gap: returns `VarRef<(...args: any[]) => R>`; params in body are `VarRef<any>`.
- Fix: carry param schema into return type and body vars: `VarRef<(...args: ParamTuple<ParamsSchema>) => R>`; body args typed via `ExtractType` per param.

5) `$.prop` allows unknown keys
- Gap: falls back to `any` if key not in object type.
- Fix: constrain `K extends keyof U`; return `U[K]`; invalid keys should be a TS error.

6) Iterable inference defaults to `any`
- Gap: `ExtractIterableElementType` and `forOf` don’t preserve literal/tuple info; fall back to `any`.
- Fix: improve extractor to handle tuples/arrays/iterables, fallback to `unknown` not `any`.

7) Unknown vs any
- Gap: many fallbacks use `any`, hiding errors.
- Fix: swap to `unknown` in inference and DSL defaults; require explicit `.as<T>()` to opt out.

8) Class helpers untyped
- Gap: `classMethod` body args are `VarRef<any>`; return type optional, not enforced.
- Fix: type params from method signature flow into `args` VarRefs; method return type enforced in added return statement shape.

9) Call helpers loose
- Gap: `methodCall` and general call sites don’t check argument types against function VarRef type.
- Fix: add typed `call` helper that takes `TypedExpression<(...args: A) => R>` and args tuple `A` → returns `TypedExpression<R>`.

10) Non-null/optional chaining
- Gap: `nonNull/optional*` lack constraints, so they accept anything and return broad `T`.
- Fix: constrain inputs to nullable types; outputs should narrow (`NonNullable<T>`, `T | undefined`).
