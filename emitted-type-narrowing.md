# Emitted declaration types are narrower than the DSL's authoring types

## Summary

The generated TypeScript annotations are currently using exact runtime inference results, which
makes emitted declarations much narrower than the DSL's authoring-time types.

Examples from the current output:

- `const name: "Alice" = "Alice";`
- `const count: 0 = 0;`
- `const user: { id: 1; name: "Bob"; ... } = ...`
- `const userId: 1 = user.id;`

That level of narrowing is usually not what we want for emitted declarations. It is especially
surprising because the DSL's phantom types are already wider and more ergonomic during authoring.

## What is happening

There are two parallel type systems in play:

1. Compile-time phantom types used by the DSL surface
2. Runtime `TSTypeDescriptor` inference used to emit `: ...` annotations

Those two systems currently disagree.

### Authoring-time DSL types are mostly widened

`InferValueType` in `src/types.ts` widens primitive inputs:

- `string` input becomes `string`
- `number` input becomes `number`
- `boolean` input becomes `boolean`

That means a binding like:

```ts
const { name } = yield * $.bind({ name: "Alice" });
```

behaves like `VarRef<string>` in the DSL, not `VarRef<"Alice">`.

The same pattern shows up in existing tests. For example, `$.prop(user, "id")` is expected to behave
like `number`, not `1`.

### Emitted declaration annotations are exact

Declaration helpers default `tsType` to `inferExpressionType(expr)`:

- `$.let(...)` in `src/dsl.ts`
- `$.const(...)` in `src/dsl.ts`
- `$.bind(...)` in `src/dsl.ts`

Then `$.block(...)` re-infers declaration types while collecting statements.

The key detail is that `inferExpressionType()` preserves literal precision:

- `literal` expressions return `types.literal(value)`
- `object` expressions recursively preserve literal property types
- `array` expressions preserve literal element unions

Those descriptors are lowered directly to TS annotations by Babel emission:

- `kind: "literal"` becomes `"Alice"`, `1`, `true`, etc.
- object properties keep those literal descriptors recursively

So the emitted output reflects exact values rather than widened declaration-friendly types.

## Why this feels wrong

The system is currently conflating two different goals:

1. Exact expression/value inference
2. Reasonable emitted declaration types

Those are not always the same thing.

Exact inference can be useful internally for:

- preserving value knowledge through transforms
- checking indexed access on literal object shapes
- supporting precise internal reasoning

But declaration emission usually wants wider, more stable types:

- `"Alice"` should often emit as `string`
- `0` should often emit as `number`
- `{ id: 1, name: "Bob" }` should often emit as `{ id: number; name: string }`

Otherwise the generated code becomes brittle and visually noisy.

## Evidence this is intentional today

This does not look like an accidental one-off regression.

There is an explicit planning note in `plan-1.md`:

> Preserve literal precision end to end where the IR is already literal-shaped.

There is also a test in `src/index.test.ts` that currently expects narrow emitted output:

- `const userId: 1 = user.id`
- `const userName: "Bob" = user.name`

So the current behavior is consistent with the present implementation and tests, even if it is
probably the wrong product choice.

## Separate but related issue

The repo also has a neighboring inference problem that makes the output feel inconsistent:

- some declarations are too narrow
- some derived expressions fall back to `unknown`

Example:

- `const upperName: unknown = name.toUpperCase();`

This happens because `$.methodCall(...)` builds a generic `call` expression, but
`inferExpressionType()` only understands calls whose callee already resolves to a function
descriptor. It does not currently infer built-in member calls like `string#toUpperCase()` from the
runtime descriptor path.

That issue is real, but it is separate from the over-narrowing problem.

## Recommended solution

Keep exact inference for internal expression analysis, but introduce a widening pass for emitted
declaration annotations.

### Proposed rule

Use:

- exact descriptors for internal inference and expression reasoning
- widened descriptors when assigning `stmt.tsType` automatically for emitted declarations

### Minimal design

Add a helper along these lines:

```ts
widenForDeclaration(descriptor: TSTypeDescriptor): TSTypeDescriptor
```

Suggested behavior:

- literal string/number/boolean -> primitive `string`/`number`/`boolean`
- literal `null` -> keep `null`
- arrays -> widen element type recursively
- tuples -> probably keep tuple shape unless the project explicitly wants tuple-to-array widening
- objects -> recursively widen property types
- unions -> widen each member, then deduplicate
- intersections -> widen each side recursively
- references/generics -> preserve as-is
- explicit user-supplied `tsType` -> preserve as-is

## Where to apply it

Apply widening only when the type annotation is being inferred automatically for a declaration:

- `$.let(...)`
- `$.const(...)`
- `$.bind(...)`
- block/function-body statement collection when patching missing or unknownish `stmt.tsType`

Do not apply it to:

- explicit `tsType` passed by the user
- `$.as(...)`
- type aliases/interfaces
- internal expression inference used for analysis

## Why this is the smallest good fix

This approach:

- preserves the existing inference engine's precision where it is useful
- fixes the generated output without rewriting the DSL type surface
- avoids breaking internal reasoning that may rely on literal descriptors
- keeps user opt-in precision possible via explicit annotations

## Expected outcome

Examples would become closer to:

```ts
const name: string = "Alice";
let count: number = 0;
const user: {
  id: number;
  name: string;
  email: string;
} = {
  id: 1,
  name: "Bob",
  email: "bob@example.com",
};

const userId: number = user.id;
const userName: string = user.name;
```

while still allowing explicitly narrow types when the caller asks for them.

## Tests to update or add

If this change is implemented, the following test expectations should change or be added:

- declaration inference widens primitive literals for emitted `const`/`let`
- declaration inference widens nested object property literals
- property access on literal-shaped objects emits widened declaration types
- explicit `tsType` still wins over widening
- internal `InferExpr` / phantom types remain unchanged unless intentionally adjusted

The existing narrow-output assertion in `src/index.test.ts` should likely be replaced with widened
expectations.

## Bottom line

The current output is narrow because emitted declaration annotations are using exact expression
inference results directly. The best fix is not to weaken internal inference globally, but to widen
only the automatically generated declaration annotations.
