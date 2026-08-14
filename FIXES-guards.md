# FIXES-guards

Branch `fix/guards` off HEAD 2957397. Baseline before: `bun test` 114 pass / 9
files, `tsc --noEmit` clean, `dprint check` clean. After: 126 pass / 10 files
(12 new tests in src/runtime-guards.test.ts), all three still clean.

Code snippets are from the worktree files; dprint's markdown plugin wraps code
lines at 80 columns while the .ts files use 150 — merge the logic, not the line
breaks.

## 1. Staging thrower (src/pipeable.ts)

**WHAT** — add `stagingError` and a throwing `Symbol.toPrimitive` on
`Prototype`; `YieldablePrototype` inherits it (`Object.create(Prototype)`), so
one place suffices.

```ts
export const stagingError = (node: unknown): never => {
  const tag = (node as { tag?: string } | null)?.tag ?? "node"
  throw new Error(
    `staging error: a ${tag} node escaped into a JavaScript operator (>, +, *, string interpolation, ...). `
      + "JS operators run at metaprogram time and cannot build nodes — use the sugar functions (add, sub, gt, ...) or $.expr for props/calls",
  )
}

export const Prototype: Pipeable = Object.assign({}, {
  [Symbol.toPrimitive](): never {
    return stagingError(this)
  },
  pipe() {/* unchanged */},
})
```

**WHY** — `x > 3` on an any-typed node previously coerced the node to a
metatime constant (`false`, `"[object Object]1"`, `NaN`) that got baked in as a
literal with zero diagnostics. Typed nodes were already rejected by TS; the
hole was every `any` path (untyped FFI, unknown denotations).

**API** — `stagingError` is a new export. Behavior change: any coercion of a
node (`String(node)`, `+node`, `${node}`, `JSON.stringify(node)`) now throws;
that is the point.

Note: `Object.assign({}, ...)` instead of a plain typed literal because TS
excess-property checks reject a symbol-keyed method on a `Pipeable`-typed
literal.

## 2. Proxy toPrimitive + 3. proxied() dedup (src/sugar/surface.ts, src/sugar/tsugar.ts)

**WHAT** — one `proxied(node, get, apply)` shared by `expr` and `texpr`; the
get trap returns a thrower for `Symbol.toPrimitive` / `"toString"` /
`"valueOf"`, with `NODE` handled first and the string-key check last:

```ts
export const proxied = <T extends object>(
  node: T,
  get: (key: string) => unknown,
  apply: (args: any[]) => unknown,
): T => {
  const target = Object.assign(() => {}, { [NODE]: node })
  return new Proxy(target, {
    get(_target, key) {
      if (key === NODE) return node
      if (
        key === Symbol.toPrimitive || key === "toString" || key === "valueOf"
      ) return () => stagingError(node)
      if (typeof key !== "string") return undefined
      return get(key)
    },
    apply(_target, _thisArg, args) {
      return apply(args)
    },
  }) as unknown as T
}
```

`expr` moves its old get/apply bodies into the handlers — get builds
`Expr.Index` for integer keys / `Expr.Prop` otherwise, apply builds the
call-expr via the existing `call` helper. `texpr`'s get keeps the literal-key
`Type.Index`; apply keeps `Type.Apply(..., tnorm)`. Behavior unchanged.

```ts
export const expr = <const E extends Expr.Expr<any>>(
  node: E,
): Surface<Expr.Denotes<E>> =>
  proxied(
    node,
    (key) =>
      isIndexKey(key)
        ? expr(
          Expr.Index(
            node as Expr.Expr<readonly unknown[]>,
            Expr.Number(Number(key)),
          ),
        )
        : expr(Expr.Prop(node as Expr.Expr<any>, key)),
    (args) => expr(call(node, args)),
  ) as unknown as Surface<Expr.Denotes<E>>

export const texpr = <const E extends Type.TypeExpr<any>>(
  node: E,
): TSurface<Type.Denotes<E>> =>
  proxied(
    node,
    (key) =>
      texpr(
        Type.Index(
          node,
          isIndexKey(key) ? Type.Literal(Number(key)) : Type.Literal(key),
        ),
      ),
    (args) => texpr(Type.Apply(node, args.map((arg) => tnorm(arg)))),
  ) as unknown as TSurface<Type.Denotes<E>>
```

**WHY** — before, coercing a surface walked into its own get/apply traps and
died with bun's useless "No default value" (the old trap turned `valueOf` into
a Prop node, then kept recursing). Now it fails with the staging error from
fix 1. The two Proxy constructions were line-for-line identical apart from the
get/apply bodies, so they collapse into one function.

**API** — new export `proxied`. `apply` takes `any[]` (the ProxyHandler
contract) so `tnorm(arg)` keeps its old inference — `unknown[]` breaks
`CheckType`'s rest-param inference in texpr.

## 4. Loud dispatch (src/emit/target.ts)

**WHAT** — `makeEmit.dispatch` validates before handler lookup:

```ts
if (
  node === null || (typeof node !== "object" && typeof node !== "function")
  || typeof node.tag !== "string"
) {
  throw new Error(
    `expected an IR node, got ${
      node === null ? "null" : typeof node
    } — a surface proxy leaked into the IR (norm() it first)`,
  )
}
```

**WHY** — `$.Call(surface as any)` previously died inside the missing-handler
path with bun's "No default value" (or worse, silently built a bogus `tag`
Prop node). Functions are admitted because `callableRef` (the sugar
Function's ref seam) is a function-shaped var-ref node and the C target passes
it as a callee; a leaked surface proxy still fails — its `tag` read goes
through the get trap and yields a surface, not a string.

**API** — none; new error for invalid inputs.

## 5. Reserved words (src/emit/text.ts)

**WHAT** — replace the IDENT regex with babel's validator:

```diff
-const IDENT = /^[A-Za-z_$][\w$]*$/
-
 const ident = (name: string, context: string): string => {
-  if (!IDENT.test(name)) {
+  if (!isValidIdentifier(name)) {
     throw new Error(`Cannot emit invalid identifier "${name}" (in ${context})`)
   }
   return name
 }
```

**WHY** — the text target emitted `const delete = 5;` (invalid TS) while the
babel target rejected the same name; the targets disagreed. Now both use
`isValidIdentifier`, so they agree: keywords and strict reserved words throw,
and unicode identifiers (e.g. `café`) that the regex wrongly rejected now emit
in both targets. Context stays in the error message.

**API** — none; strictness change (reserved words now throw in the text
target).

## 6. Import collisions (src/emit/program.ts)

**WHAT** — track each local name's source; a second source for the same local
throws:

```ts
const found = new Map<string, ImportBinding>()
const sources = new Map<string, string>()
walk(statements, (node) => {
  if (node.tag !== "var-ref") return
  const { name, source } = node as Expr.VarRef<any, any>
  if (source === undefined) return
  const existing = sources.get(name)
  if (existing !== undefined && existing !== source) {
    throw new Error(
      `cannot import "${name}" from both "${existing}" and "${source}"`,
    )
  }
  sources.set(name, source)
  const key = `${source} ${name}`
  if (!found.has(key)) found.set(key, { local: name, source })
})
```

**WHY** — two sources mapping to one local name silently emitted two
`import * as moda` bindings (invalid TS, and a wrong program even where a
target tolerates it). Same-name-same-source dedupe is preserved.

**API** — none; new error at emit time.

## Tests (src/runtime-guards.test.ts)

12 new tests: operator coercion on plain/yieldable nodes throws and names
`add, sub, gt, ...` and `$.expr`; a dead-code `@ts-expect-error` pins that TS
still rejects `x > 3` on typed nodes at compile time; `stagingError` export
names the tag; surface and type-surface coercion throws the staging error
(instead of "No default value"); dispatch rejects null/primitives/untagged
objects and names leaked surfaces on all three of expr/statement/type;
`Const("delete")` throws in both text and babel targets; `café` emits in both;
import collisions throw listing both sources; same-import dedupe still emits
one line.

## Verified

`bun test`: 126 pass (all 114 prior tests included — the toPrimitive thrower
breaks nothing). `tsc --noEmit` clean. `dprint check` clean.
