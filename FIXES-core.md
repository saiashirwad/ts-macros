# FIXES-core

Branch `fix/core`, base HEAD 2957397. Three commits, one per fix. Final state:
`bun test` 115 pass (114 + 1 new), `tsc --noEmit` clean, `dprint check` clean.

## 1. ConstWiden reduces to a top-level literal check + Widen

WHAT (src/expr.ts):

```ts
// before
export type ConstWiden<A> =
    A extends Variable<any> ? A
  : A extends Generic<any, any> ? A
  : A extends string | number | boolean ? A
  : A extends (...args: any[]) => any ? A
  : A extends object ? { [K in keyof A]: Widen<A[K]> }
  : A

// after
// top-level literal stays literal; everything nested widens like Widen
export type ConstWiden<A> = A extends string | number | boolean ? A : Widen<A>
```

WHY: every clause of the old chain was a distributive conditional on naked
`A`, so the two forms agree member-by-member: `Variable` and `Generic`
pass through `Widen` untouched, functions pass through, objects map each
field through `Widen`, primitives and null fall through. Identical
semantics across all 6 cases (wt-core REPORT §4); now reuses `Widen`
instead of re-listing 5 of its 6 clauses.

API change: none — same exported name, same type-level results.

## 2. Object-literal fields widen during synthesis

WHAT (src/emit/synthesize.ts, `compute` case `"object"`):

```ts
// before
fields[key] = type

// after
fields[key] = widen(type)
```

WHY: field types were stored unwidened, so `const obj = {a: 1}`
synthesized `{a: 1}` while the type level (`ConstWiden`) says `{a: number}`.
Runtime `widen` agrees with type-level `Widen` on every case (wt-core
REPORT §4), so widening each field on the way in closes the divergence.
Matches the existing type-level test "const widens object fields but the
binding is not assignable" (`{count: number}`).

Test (src/synthesize.test.ts): "const object literals widen their fields
like the type level" pins `$.Const("obj", $.norm({ a: 1, nested: { s: "ok" } }))`
to `{ a: number; nested: { s: string } }`.

API change: none.

## 3. mapType functor extracted from substituteType

WHAT (src/emit/synthesize.ts): the recursive rebuild switch moves into a
module-private `mapType(type, fn)` that rebuilds composite nodes and hands
every leaf to `fn`; `substituteType` becomes `mapType` plus a param lookup.

```ts
// rebuild every composite node, handing each leaf to fn; the runtime
// counterpart of the type-level Substitute is just this plus a param lookup
const mapType = (
  type: TypeNode,
  fn: (leaf: TypeNode) => TypeNode,
): TypeNode => {
  // ...the same switch, children through mapType, leaves through fn...
}

// substituteType is the emit-time shadow of the type-level Substitute,
// needed only after phantoms erase
export const substituteType = (
  type: TypeNode,
  bindings: ReadonlyMap<string, TypeNode>,
): TypeNode =>
  mapType(type, (leaf) => {
    const node = leaf as Type.Any
    return node.tag === "param" && bindings.has(node.name)
      ? bindings.get(node.name)!
      : leaf
  })
```

WHY: substituteType is the emit-time shadow of the type-level Substitute,
needed only after phantoms erase. Traversal and substitution are two
concerns; the functor is reusable for any future type-tree rewrite.
Port of wt-core commit 94c9fe9.

API change: none — `substituteType` keeps its name, signature, and
export; `mapType` is module-private.
