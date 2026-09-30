# Where denotations diverge from TypeScript inference

Research for [#29](https://github.com/saiashirwad/ts-macros/issues/29), in [map #32](https://github.com/saiashirwad/ts-macros/issues/32). Investigated 2026-10-01 against ts-macros `d4dbe8c3183fc4dad493003e75af0757bff0722a` and installed **TypeScript 7.0.2**.

## Answer

The reported `"A"` / `"B"` discrepancy is real, but **nested returns are not being dropped**. The stage-1 generator's plain final `return "B"` is inferred as `string` before `WidenReturn` receives it. `ReturnValue<Yields>` does preserve the nested `Literal<"A">`; joining that with `Literal<string>` already gives `string`. Returning `Expr.string("B")` instead preserves `"A" | "B"`. Both builders emit identical stage-2 text, and the built function's runtime type node correctly contains the two literal members. See the checked reproduction below and [M2], [M3], [M4].

`WidenReturn` approximates ordinary, uncontextualized return inference reasonably when it receives intact expression types. `WidenFresh` and `bindingType` match simple scalar declarations, but do not reproduce the checker in general. Further concrete gaps are mutable-location typing of raw object expressions, widening *before* logical-operator evaluation, contextual typing, object-union normalization, and empty-array runtime type attachment. Existing tests pass because the emitted-program test inserts annotations; it checks compatibility with those annotations rather than equality with inference from the actual emitted text [M7].

## Scope and sources

“Denotation” here means `Expr.Denotes<E>`, the stage-2 type read at stage 1, not the optional runtime `node.type` [M1]. These are separate observations and can disagree. For bindings, the table compares the inferred **declaration type**; a reference at a particular stage-2 use site can additionally be narrowed by control flow. For example, `let x = false && "b"` has declaration type `boolean`, but `typeof x` immediately afterward is `false`.

The installed package is the native TypeScript 7 compiler. Its `package.json` records `gitHead` `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`; primary checker citations below pin that commit in Microsoft's `typescript-go` repository. This avoids treating an older compiler implementation as the version actually tested. Probes used `--strict --exactOptionalPropertyTypes`, ESNext, and declaration emit or type-equality assertions. They did not enable `noUncheckedIndexedAccess` unless running the repository's own configuration. The repository does enable it [M8], which is another reason not to promise equality independently of compiler options.

## TypeScript's rules

### 1. Initializers and freshness

- An unannotated mutable declaration widens **fresh** string, number, bigint, boolean, and enum literal types; widening maps over union members. A const declaration skips this top-level literal widening. A literal type that is not fresh is retained. The checker stores freshness on types, not a single flag for an entire expression [T1]. Thus `let x = "a"` is `string`, `const x = "a"` is `"a"`, `const c = "a"; let x = c` is `string`, and copying a value explicitly typed `"a"` retains `"a"`.
- Mutable locations inside object and array literals have their own contextual check. `const` on the outer binding does **not** make fields readonly or suppress their widening: `const o = {a: 1}` is `{a: number}`. A literal-compatible contextual type or const-assertion context can preserve literals instead [T2].
- `bindingType` selects the annotation if present, otherwise `widenFresh` for `let` and `constType` for `const`. That is the right high-level split. However, its expression-kind recursion and `Ref.fresh: boolean` are only an approximation of checker freshness [M2]. Selecting an annotation does not implement the checker's top-down contextual typing of its initializer.

### 2. Functions, arrows, and nested returns

- For ordinary block-bodied functions and arrows, the checker collects return-expression types and forms a **subtype-reduced union**. A single unit result is eligible for contextual literal widening; a genuine multi-member union of literals is not widened by that step. A later widening pass handles compound types [T3]. Therefore `return "A"` alone normally infers `string`, but `if (b) return "A"; return "B"` infers `"A" | "B"`. Repeated returns of the same fresh literal collapse to one result and widen.
- An expression-bodied arrow starts with the body's expression type, then uses the same later widening logic. `(b: boolean) => b ? "A" : "B"` also keeps the union [T3]. The current target emits only block-bodied arrows [M5].
- Return traversal enters control-flow statements, not nested function bodies [T4]. ts-macros has the same boundary in `blockReturnType`. At stage 1, `IfBuilder` exposes nested yielded return types, and loops propagate their `PhantomReturns` [M3].
- Context matters: `const f: () => "A" | "B" = () => { return "A" }` accepts and preserves a literal-compatible return in the initializer. An arrow constructed independently by `Expr.arrow` has already inferred its return before `Decl.const_` sees any annotation [T2], [T3], [M4].
- With strict null checking, a reachable fallthrough or bare `return` adds `undefined` when there are value returns. No value returns normally gives `void`; never-returning function expressions/arrows have special `never` behavior. Return inference also skips certain direct recursive calls [T3]. `blockReturnType` is a tree collection, not these flow rules. Public builder bodies currently require a liftable final value and materialize a trailing return, so arbitrary fallthrough/void-only bodies are not directly expressible by that API [M4].

### 3. Objects and arrays

- Ordinary object fields and array elements are checked as mutable locations, widening fresh literals unless a relevant context preserves them [T2]. Nonempty heterogeneous arrays use a subtype-reduced union of element types; tuple/const contexts use different paths. A plain array literal is not inferred as a tuple just because its length is known [T5].
- Under strict null checking an empty array *expression* starts with an implicit-never element type. Empty arrays in object properties and returned expressions infer `never[]`. Unannotated local `let/const xs = []` can instead use an evolving-array type, accumulating element information from later writes; a universal “empty arrays are never[]” rule is wrong [T5], [T6].
- Widening unions of object literals tracks sibling shapes and adds missing optional properties. For `if (b) return {a:1}; return {b:2}`, 7.0.2 declaration emit produces `{a:number; b?:never} | {a?:never; b:number}` with exact optional properties enabled [T7]. A plain union of `{a:number} | {b:number}` is not the same property-access surface.

### 4. Binary operators

- Numeric arithmetic returns `number`, not a computed numeric literal. Bigint arithmetic returns `bigint` when both operands allow it. Addition returns `number` for number-like operands, `bigint` for bigint-like operands, `string` when an operand is string-like, and has separate `any`/error cases. Symbols are rejected even with a string operand [T8].
- Comparisons return `boolean`, but operand validity is checked separately: equality needs comparable types; ordered comparison admits more than just number-number or string-string, including number/bigint combinations [T9].
- With strict null checking, `L && R` retains definitely-falsy alternatives of `L` plus `R` when `L` can be truthy; if `L` is definitely falsy, it returns `L`. `L || R` removes definitely-falsy/nullish alternatives from `L` and joins `R` when needed. These rules act on operand types **before the containing declaration widens the result** [T10]. Widening operands first changes which branches appear possible.

## Comparison table

Results are for the shown unannotated stage-2 shape unless stated otherwise. “Runtime” refers to a built node's attached type; an absent runtime type is not a denotation of `undefined`. Rows marked “source” are implementation comparisons rather than a claim that every variation was executed.

| Rule / stage-2 shape | TypeScript result | ts-macros result | Match? / evidence |
| --- | --- | --- | --- |
| `let n = 1`; `const n = 1` | `number`; `1` | `WidenFresh`: `number`; `ConstType`: `1` | Yes, basic case [T1], [M2]; existing tests pass |
| Copy fresh const to let; copy explicitly typed literal to let | Primitive; retained literal | `Ref.fresh` chooses widening versus retention | Yes for these simple cases [T1], [M2] |
| `const o = {a:1}` or `let o = {a:1}` | `{a:number}` | Binding denotation/runtime `{a:number}` | Yes [T2], [M2] |
| Raw `{a:1}` expression, or direct `({a:1}).a` | `{a:number}`; `number` | `Expr.object({a:1})` denotes `{a:1}`; direct `prop` denotes `1` | **No**; object construction delays field widening until a containing binding/return/array [M4] |
| `return "A"` alone, with intact `Literal<"A">` input | `string` | `WidenReturn` and `returnTypeOf`: `string` | Yes [T3], [M2] |
| `if(b) return "A"; return "B"`, final builder value `Expr.string("B")` | `"A" \| "B"` | Denotation and built runtime: `"A" \| "B"` | Yes; checked reproduction |
| Same text, plain final stage-1 `return "B"` | `"A" \| "B"` | Denotation `string`; built runtime `"A" \| "B"` | **No**; stage-1 final-value widening, not lost nesting |
| Block-bodied arrow with intact literal-node returns | Same union rule as functions | Same `WidenReturn` rule | Rule matches; public arrow inference has a separate API issue noted by tests [M4], [M7] |
| Returns inside nested functions | Excluded from enclosing function | Runtime traversal skips arrows/function declarations; returned function is a value | Yes for the traversal boundary [T4], [M2] |
| Two distinct returned object-literal shapes | Normalized union with missing optional properties | Union of widened shapes without missing optional properties | **No**, source + declaration-emit observation [T7], [M2] |
| Contextually typed arrow returning one literal | Context can keep the literal | Independently constructed arrow already widens it | **Not generally modeled**, source [T2], [M4] |
| `["a", 1]`; `[stableLiteral]` | `(string \| number)[]`; literal-element array | `WidenFresh<Elements[number]>[]` | Yes for these basic cases [T5], [M4] |
| Empty array returned from a function / in an object field | `never[]` under strict null checks | Denotation `never[]`; `Expr.array()` runtime type absent | Denotation yes here, runtime **missing** [T5], [M4] |
| Local empty array followed by writes | Evolving-array inference | Fixed `never[]` denotation | **No**, source; no flow-sensitive accumulation [T6], [M4] |
| Number `+ - * / %`, or string concatenation without disallowed operands | `number` / `string` | Same basic primitive results | Yes for supported ordinary operands [T8], [M2] |
| Bigint `+ - * / %` via external bigint values | `bigint` | Operand check rejects bigint | **No / unsupported operand domain**, source [T8], [M2] |
| `"x" + symbolValue`; `1 === "x"` | Diagnostics (not valid stage-2 programs) | String concatenation / equality checks admit them | **No**, operand-validation gap [T8], [T9], [M2] |
| `const x = false && "b"` | `false` | `false` | Yes, logical result before widening [T10], [M2] |
| `let x = false && "b"` | Declaration `boolean`; immediate use narrowed to `false` | Denotation and runtime `false \| string` | **No**; `WidenFresh` computes `boolean && string`, introducing an impossible right branch |

The annotation path in `bindingType` correctly reports the written declaration type, but this is not proof that the initializer is contextually checked correctly, nor that every emitted reference has that unnarrowed type. Indexing is also option-sensitive: `noUncheckedIndexedAccess` can add `undefined`, whereas `Expr.index` simply reports the array element denotation [M4], [M8]. These are separate dimensions from literal widening.

## Minimal checked reproduction of the reported discrepancy

Save as `inference-repro.ts` at the repository root and run `npx tsc --noEmit`, then `node inference-repro.ts`. Remove it afterward; it is a research probe, not a proposed library change.

```ts
import { Decl, Expr, Program, Stmt, Type } from "./src/index.ts"
import { emitProgram } from "./targets/typescript/index.ts"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T

const p = Program.build(function* () {
  const raw = yield* Decl.fn("raw", {
    params: [Expr.param("b", Type.boolean)],
    body: function* ({ b }) {
      yield* Stmt.if_(b, function* () { yield* Stmt.return_("A") })
      return "B"
    },
  })
  const nodes = yield* Decl.fn("nodes", {
    params: [Expr.param("b", Type.boolean)],
    body: function* ({ b }) {
      yield* Stmt.if_(b, function* () { yield* Stmt.return_("A") })
      return Expr.string("B")
    },
  })
  type Raw = Check<Equal<Expr.Denotes<typeof raw>, (b: boolean) => string>>
  type Nodes = Check<Equal<Expr.Denotes<typeof nodes>, (b: boolean) => "A" | "B">>
  return { raw, nodes }
})

function stage2(b: boolean) { if (b) return "A"; return "B" }
type Actual = Check<Equal<ReturnType<typeof stage2>, "A" | "B">>
console.log(emitProgram(p))
console.log(JSON.stringify(p.statements, null, 2))
```

Both emitted functions have `if (b) { return "A"; } return "B";`, with no return annotation. Both built function nodes attach a union of literal `"A"` and literal `"B"`. The three type assertions pass on 7.0.2. The experiment used direct `Decl.fn`, not only the inference workaround wrapper from the tests.

Why this happens:

1. `return_("A")` has a const generic and returns `ReturnStatement<Literal<"A">>` [M3].
2. `yield* if_` includes that nested yielded type in the enclosing generator's yielded union [M3].
3. `Decl.fn` infers `Final` through the stage-1 generator. A plain final string value is widened to `string`; the node-return variant carries `Literal<"B">` instead. `Lift<Final>` cannot recover a literal value after its type has widened [M4].
4. `ImplReturn` computes `WidenReturn<Lift<Final> | ReturnValue<Yields>>`. With the plain value, `ConstType` already reduces the result to `string`; altering the final `IsUnion` test cannot restore `"B"` [M2], [M4].
5. Runtime construction still sees the actual JavaScript value `"B"`, lifts it to a literal node, and `blockReturnType` sees both exact literals [M2], [M4]. The emitter does not force the runtime inferred type into an annotation [M5].

## Validation, recommended next steps, and limits

Executed in the isolated checkout:

- `bun install` installed TypeScript 7.0.2.
- `npx tsc --noEmit`: passed.
- `node --test`: **131 passed**, zero failures.
- Isolated strict type assertions checked the raw/node final-return difference, raw object denotation `{a:1}`, empty-array denotation `never[]`, and `let` logical denotation `false | string`. Runtime inspection confirmed both function return unions and the incorrect logical union. Additional declaration-emit probes confirmed ordinary scalar, object, array, function, expression-arrow, and object-union results in the table. An exploratory literal `"a" || "b"` also produced the compiler's always-truthy diagnostic; it was not used as a valid-program counterexample.

Recommended implementation order (recommendations, not changes made by this ticket):

1. Preserve literal final values across stage-1 callback inference, shared by function and arrow construction; retain a regression showing plain-value and node-value bodies emit and denote identically. Do not “fix” this by widening every stage-2 return union to `string`.
2. Add an oracle that checks **unannotated emitted text**, with typed external declarations, against stage-1 denotations and runtime type nodes separately. The current `annotated` helper changes inference and `ambient` substitutes `any` for externals [M7].
3. Evaluate logical expressions before widening the result, and give object expressions their mutable-property types at construction. Follow up with per-member freshness/context handling rather than assuming one boolean captures all cases.
4. Specify supported compiler options and contextual-typing/flow boundaries; then test empty arrays, object unions, operand diagnostics, annotations, and external values explicitly.

Not confirmed exhaustively: all mixtures of fresh and regular union members; recursive generic return inference; contextual callbacks nested in objects/arrays; every `any`, `unknown`, enum, symbol, bigint, or template-literal operand; all control-flow narrowing cases. The table establishes counterexamples, not a complete replacement checker. Async/generator stage-2 functions, const assertions, array spreads and contextual tuples are checker rules but are not currently represented by these expression builders. No core implementation was changed.

## Primary-source references

TypeScript native checker at the installed package's pinned commit:

- [T1] [Initializer const/mutable split](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L16810-L16815); [fresh-literal widening](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L25395-L25411).
- [T2] [Mutable-location expression checking](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L13802-L13811); [contextual literal widening](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L25423-L25450); [property assignment checking](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L13605-L13620).
- [T3] [Return type from body](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L20031-L20160); [return aggregation and fallthrough](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L20163-L20224).
- [T4] [Return-statement traversal](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/ast/utilities.go#L1138-L1195).
- [T5] [Array literal checking](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L7998-L8120).
- [T6] [Automatic empty-array declaration type](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L16595-L16630); [flow type of references](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L11105-L11165).
- [T7] [Object widening with missing properties](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L18313-L18361).
- [T8] [Arithmetic and addition](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L12321-L12422).
- [T9] [Comparison typing and diagnostics](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L12423-L12453).
- [T10] [Logical operators](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L12458-L12479).

Repository sources at the investigated revision:

- [M1] [Vocabulary and denotation contract](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/CONTEXT.md#L7-L16).
- [M2] [`WidenFresh`, `ConstType`, `WidenReturn`, bindings, traversal, binary results](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/typing.ts#L18-L255).
- [M3] [Returns and control-flow propagation](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/statement.ts#L46-L288).
- [M4] [Lifting, objects/arrays, and arrows](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/expr.ts); [function return inference](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/declaration.ts#L175-L225).
- [M5] [TypeScript emission: only explicit annotations are emitted](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/targets/typescript/index.ts#L137-L180).
- [M6] [Runtime union and widening algebra](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/src/types/algebra.ts#L102-L141).
- [M7] [Current inference workarounds in tests](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/tests/typing.test.ts#L8-L35); [annotation-based emitted test and external declarations](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/tests/typing.ts#L44-L125).
- [M8] [Compiler options](https://github.com/saiashirwad/ts-macros/blob/d4dbe8c3183fc4dad493003e75af0757bff0722a/tsconfig.json).
