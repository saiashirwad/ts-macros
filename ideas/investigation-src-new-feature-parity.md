# Investigation: src → new feature parity

## Summary

`new/` is currently a tracer-bullet reimplementation focused on pipeable
declarations, literals, objects, generic type params, and simple function/type
application. To reach practical feature parity with `src/` **without doing
Babel/codegen yet**, the main remaining work is not just “more builders”: you
still need a broader expression/type surface **and** a semantic layer for
declaration/type inference, scoped build contexts, and derived type queries.

## Symptoms

- `new/` intentionally exposes a much smaller surface than `src/`.
- The migration target allows a cleaner pipeable API, so parity should be judged
  by **semantic capability**, not exact helper names.
- Babel lowering/codegen is explicitly out of scope for this investigation.

## Investigation Log

### Phase 1 - Initial Assessment

**Hypothesis:** `new/` covers only a narrow declaration/type subset; most
missing work will be in expression forms, declaration builders,
inference/runtime semantics, and class-related DSL. **Findings:** Confirmed from
the roadmap, `new/` public exports, and `src/index.ts`/tests that `new/`
currently exposes a much smaller surface. **Evidence:**

- `plans/new-reimplementation-roadmap.md:1-250`
- `new/$.ts:1-16`
- `new/type.ts:1-7`
- `src/index.ts:1-82`
- `src/index.test.ts` (138 tests spanning the old feature set) **Conclusion:**
  Confirmed; deeper breakdown was required.

### Phase 2 - Current `new/` implementation scope

**Hypothesis:** `new/` is currently designed around a small pipeable core rather
than full old-DSL coverage. **Findings:** The public API in `new/` is only
let/function/type declarations, object literals, string/number literals, type
params, and a handful of type constructors. The playgrounds only exercise those
same capabilities. **Evidence:**

- `new/$.ts:1-16` exports only `let`, `function`, `call`, `instantiate`, `p`,
  `params`, `returns`, `object`, `typeParams`, `type`, `body`, `number`,
  `string`.
- `new/type.ts:1-7` exports only `string`, `number`, `apply`, `literal`,
  `object`, `param`, `union`.
- `new/play.ts:5-47` demonstrates only generic types, generic functions, call,
  instantiate, let, object, annotate.
- `new/playground.ts:43-257` exercises the same narrow surface and acts more
  like a type-system sandbox than a feature-complete DSL. **Conclusion:**
  Confirmed; `new/` is currently a minimal core, not a near-parity
  implementation.

### Phase 3 - Function/declaration parity gaps

**Hypothesis:** Function declarations in `new/` are still missing old parameter
semantics, async forms, and body-driven return inference. **Findings:** `new/`
functions support typed params, explicit return annotations, implementations,
and generic instantiation, but params have no optional/rest/default metadata,
there is no async function builder, and the runtime just collects yielded
declarations instead of building inferred function metadata. **Evidence:**

- `new/functions/params.ts:5-18` defines `Param` with only
  `{ _tag, name, type }`; there is no `optional`, `rest`, or `default` field.
- `new/declarations/function.ts:58-76` defines `FunctionDecl` with only `name`,
  `typeParams`, `params`, `returnType?`, `impl?`.
- `new/declarations/function.ts:167-174` `p(...)` accepts only
  `(name, annotation)`.
- `new/declarations/function.ts:232-239` `call(...)` accepts only
  `(callee, args)`; there is no type-argument slot.
- `new/runtime/run-macro.ts:5-35` only iterates the generator and collects
  declarations; it does not infer declaration annotations or function return
  types.
- Old parity expectations:
  - `src/index.test.ts:1523-1604` requires optional/rest/default params and
    correct type inference.
  - `src/index.test.ts:1441-1521` requires async function support preserving
    `Promise<...>` inference.
  - `src/index.test.ts:3178-3243` requires function-like builders to infer
    runtime return descriptors from explicit return statements.
  - `src/dsl.ts:708-746` shows the old implementation collecting function body
    statements and inferring return types.
  - `src/dsl.ts:2301-2342` and `src/dsl.ts:2953-2999` show old `function` and
    `async` builders using that inference machinery. **Conclusion:** Confirmed.
    To replace old function authoring semantics, `new/` still needs richer param
    modeling, async declarations, and some replacement for old body/return
    inference.

### Phase 4 - Expression surface parity gaps

**Hypothesis:** Most old expression-building capability is still absent from
`new/`. **Findings:** `new/` currently has literals, object literals, calls,
refs, and function/type instantiation. The old API and tests cover a much larger
expression set used for both authoring and inference. **Evidence:**

- `new/$.ts:1-16` contains no
  array/member/optional/await/conditional/template/assignment/etc exports.
- A search across `new/` found no support for `async`, `await`, `optional`,
  `spread`, `template`, `member`, `prop`, `array`, `module`, `import`, `export`,
  `class`, `enum`, `namespace`, or `declare`.
- Old tests explicitly cover these expression capabilities:
  - `src/index.test.ts:88-198`
    (`core DSL builders preserve inference across expressions and helpers`)
    covers array, template, ternary, nullish, await, method call, optional
    property/call, `as`, `satisfies`, non-null, typed call, `new`, tagged
    template, assignment, numeric/compare/string/logic helpers.
  - `src/index.test.ts:1628-2148` covers ternary, spread, nullish, optional
    member/call inference, arrow functions, member/computed member, `new`,
    `this`, `as`, `satisfies`, non-null, update expressions, tagged templates,
    template literals, and assignment operators.
  - `src/index.test.ts:2149-2401` covers statement forms needed inside
    function/block bodies: throw, break, continue, while, do-while, switch,
    try/catch/finally.
- Old DSL surface confirms that breadth:
  - `src/dsl.ts:1690-1700` begins the large `$` object.
  - `src/dsl.ts:3004-3212` exports `numeric`, `compare`, `str`, and `logic`
    helper namespaces. **Conclusion:** Confirmed. If you want semantic parity
    with old authoring power, expression constructors are one of the biggest
    remaining chunks.

### Phase 5 - Type-system parity gaps

**Hypothesis:** The old type-level DSL is much richer than what `new/type.ts`
currently supports, and several old features depend on that richness rather than
on Babel. **Findings:** `new/type.ts` currently exposes only seven constructors.
The old system includes primitive variants,
collection/function/reference/generic forms, derived type queries, and richer
object/tuple wrappers. Some of those are required for downstream typing even
before codegen exists. **Evidence:**

- `new/type.ts:1-7` exports only `string`, `number`, `apply`, `literal`,
  `object`, `param`, `union`.
- `new/type-level/object.ts:4-24` only allows
  `{ [key: string]: TypeExpr<any> }`; there is no support for field wrappers
  like `{ type, optional, readonly }`.
- Old `type` surface:
  - `src/dsl.ts:3214-3237` exports `boolean`, `any`, `void`, `undefined`,
    `null`, `never`, `unknown`, `array`, `union`, `intersection`, `function`,
    `object`, `generic`, `reference`, `promise`, `literal`, `tuple`, `keyof`,
    `typeof`, `typeQuery`, `indexedAccess`, `conditional`, `mapped`,
    `templateLiteral`, `infer`.
- Old tests that rely on non-Babel type expressiveness:
  - `src/index.test.ts:217-311` uses `type.array(...)` with `TypeRef` reuse.
  - `src/index.test.ts:408-465` uses `type.indexedAccess(...)` against declared
    types.
  - `src/index.test.ts:466-480` and `3135-3148` require optional/readonly object
    property wrappers.
  - `src/index.test.ts:2980-2995` requires `TypeRef` resolution through
    generic/reference descriptors.
  - `src/index.test.ts:3053-3090` exercises `intersection`, `function`,
    `reference`, `promise`, `keyof`, `typeof`, `indexedAccess`, `conditional`,
    `mapped`, and `templateLiteral`.
  - `src/index.test.ts:3125-3134` requires tuple optional elements.
  - `src/index.test.ts:3150-3176` requires function type support beyond five
    params. **Conclusion:** Confirmed. Even if the final API is cleaner,
    substantial type-level work remains for parity.

### Phase 6 - Semantic infrastructure and build-context gaps

**Hypothesis:** Full parity requires more than syntax builders; the old system
depends on a semantic layer for type alias/class registries, scoped contexts,
and expression/declaration inference. **Findings:** `new/` currently has almost
no semantic runtime beyond `runMacro`, while `src/` has a build context,
registries, expression inference, declaration widening, and local block scoping.
These are needed for features like `typeof`, indexed access over refs, local
type aliases, and class/type reuse. **Evidence:**

- `new/runtime/run-macro.ts:5-35` only accumulates declarations and prints debug
  output.
- Old build-context implementation:
  - `src/context.ts:3-33` defines `BuildContext`, default registries, and
    active-context management.
  - `src/context.ts:35-67` implements `registerTypeAlias`, `registerClass`,
    `lookupTypeAlias`, and `lookupClass`.
- Old block/context behavior:
  - `src/dsl.ts:163-188` builds a fresh context per block and infers declaration
    types while collecting statements.
  - `src/index.test.ts:2651-2672` verifies enums register descriptors and blocks
    keep local build contexts.
- Old expression inference engine:
  - `src/infer.ts:504-518` implements `normalizeToExpression`.
  - `src/infer.ts:930-1150` covers expression type inference for arrays,
    objects, binary ops, calls, optional calls, members, await, conditional,
    nullish, spread, `satisfies`, non-null, assignment, tagged templates, etc.
    **Conclusion:** Confirmed. A major hidden chunk of parity work is rebuilding
    enough semantic infrastructure to power typed refs and derived type queries
    in `new/`.

### Phase 7 - Classes, enums, modules, and FFI

**Hypothesis:** Several large old subsystems are still completely absent from
`new/`, and some are likely intentional later phases rather than near-term
blockers. **Findings:** `new/` contains no class, enum, import/export/module,
namespace, declare, or FFI facilities. In `src/`, these are first-class features
with extensive test coverage. **Evidence:**

- Search over `new/` returned no implementations for
  class/enum/module/ffi-related terms.
- Old class/enum/module/ffi coverage:
  - `src/index.test.ts:578-1180` class refs, class members, constructor
    inference, host classes, method refs, getters/setters.
  - `src/index.test.ts:2402-2609` basic class syntax features.
  - `src/index.test.ts:2610-2679` enums and context registration.
  - `src/index.test.ts:2685-2931` FFI globals/imports, module import hoisting,
    imports, exports, namespace, and declare forms.
- The roadmap already frames larger expansion areas as later work:
  `plans/new-reimplementation-roadmap.md:376-495`. **Conclusion:** Confirmed.
  These are major parity gaps, but some can reasonably be deferred depending on
  your intended scope for the first `new/` milestone.

## Root Cause

The parity gap is primarily architectural, not cosmetic.

`src/` is not just a bag of builders; it combines:

1. A **broad surface DSL** for declarations, expressions, statements, modules,
   classes, and types.
2. A **semantic layer** that infers expression/declaration types, tracks local
   build context, and registers named types/classes.
3. A **lowering/codegen layer** (which you explicitly want to defer).

`new/` currently has only a slice of (1), almost none of (2), and none of (3).

The clearest evidence is:

- tiny current exports in `new/$.ts:1-16` and `new/type.ts:1-7`
- minimal param/object/type modeling in `new/functions/params.ts:5-18` and
  `new/type-level/object.ts:4-24`
- no semantic execution beyond declaration collection in
  `new/runtime/run-macro.ts:5-35`
- versus the old system’s scoped build contexts in `src/context.ts:3-67`,
  top-level/block collection in `src/dsl.ts:163-188`, function-body return
  inference in `src/dsl.ts:708-746`, and rich expression inference in
  `src/infer.ts:930-1150`

So the remaining work for feature parity is not merely “port the rest of the
helpers”; you also need to decide how much of the old
descriptor/context/inference machinery gets reintroduced in a cleaner shape.

## Recommendations

1. **Finish the core authoring surface first**
   - Add the high-leverage expression constructors that show up repeatedly in
     old tests and roadmap goals: arrays, property/member access, computed/index
     access, optional access/call, nullish/conditional, template/tagged
     template, `await`, `new`, assignment/update, and likely a small statement
     set for function bodies.
   - Likely files: new modules under `new/expressions/` plus `new/$.ts` export
     surface.

2. **Upgrade function parameter and function-body semantics**
   - Extend `Param` in `new/functions/params.ts` to support
     optional/rest/default metadata.
   - Add async function declarations and either explicit return statements or
     equivalent body analysis.
   - Decide whether the new system infers function return types from
     yielded/returned body expressions like `src/dsl.ts:708-746`.

3. **Expand the type DSL before touching Babel**
   - The minimum likely useful parity set is: `boolean`, `unknown`, `undefined`,
     `null`, `array`, `tuple`, `intersection`, `function`, `promise`, `typeof`,
     `indexedAccess`, and richer object fields (`optional`, `readonly`).
   - A second tier is: `reference`/`generic`, `keyof`, `conditional`, `mapped`,
     `templateLiteral`, `infer`.

4. **Rebuild a semantic context layer in the new architecture**
   - Add some notion of block/program context to track declared
     types/functions/classes and make derived type queries work.
   - This is the piece that enables real parity for `TypeRef` reuse,
     `typeof(varRef)`, indexed access on declared/object-ref shapes, and
     class/type registration.

5. **Defer large subsystems intentionally unless they are in your immediate
   migration target**
   - Classes
   - Enums
   - FFI/import/export/module/namespace/declare
   - These are clearly absent and large; if they are not needed for your first
     milestone, explicitly mark them as deferred parity rather than leaving them
     ambiguous.

## Preventive Measures

- Maintain a parity checklist derived from `src/index.test.ts`, grouped into:
  - declarations/functions
  - expressions/statements
  - type constructors
  - semantic context/inference
  - classes/modules/ffi
- Distinguish **API-shape parity** from **semantic parity** in planning
  documents so you can intentionally replace old helper names without losing
  capabilities.
- Add compile-time tests in `new/` as soon as each semantic bucket lands; many
  old tests are really type-inference tests and can be ported without Babel.
- Remove or gate the debug `console.log` in `new/runtime/run-macro.ts:12-24`
  before using it as the foundation for broader semantics.
