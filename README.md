# ts-macros

Staged metaprogramming for TypeScript.

```ts
import { Decl, Expr, Program, Type } from "ts-macros"
import { emitProgram } from "ts-macros/targets/typescript"

function power(x: Expr.In<number>, n: number): Expr.Expr<number> {
  let result: Expr.Expr<number> = Expr.number(1)
  for (let i = 0; i < n; i++) result = Expr.mul(result, x)
  return result
}

function* savedPower(x: Expr.In<number>, n: number) {
  return yield* Decl.const_("tmp", power(x, n))
}

const program = Program.build(function*() {
  return yield* Decl.fn("polynomial", {
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return Expr.add(cube, square)
    },
  })
})

console.log(emitProgram(program))
```

```text
function polynomial(x: number) {
  const tmp = 1 * x * x * x;
  const tmp_2 = 1 * x * x;
  return tmp + tmp_2;
}
```

## Emit JavaScript

Use the JavaScript target to generate runnable source from the same program.

```ts
import { emitProgram as emitJavaScript } from "ts-macros/targets/javascript"

console.log(emitJavaScript(program))
```

```text
function polynomial(x) {
  const tmp = 1 * x * x * x;
  const tmp_2 = 1 * x * x;
  return tmp + tmp_2;
}
```

This target omits type declarations, annotations, optional parameter markers, and generic parameters and arguments. It preserves runtime expressions, control flow, binding names, and namespace FFI imports. The output uses modern JavaScript without downleveling.

## Narrow with guards

A generated `if` does not refine the type of a staged expression. A guard does: it pairs a runtime test with the type TypeScript gives its subject when the test passes. `Stmt.ifGuard` passes that narrowed value to its branch, and the guard clause `Stmt.guard` returns it after a failure body that must exit.

```ts
body: function*({ input }) {
  yield* Stmt.ifGuard(Guard.isArray(input), function*(items) {
    yield* Stmt.return_(Expr.prop(items, "length"))
  }, "items")
  const text = yield* Stmt.guard(Guard.typeof_(input, "string"), function*() {
    yield* Stmt.return_(0)
  }, "text")
  return Expr.prop(text, "length")
}
```

```text
function size(input: unknown) {
  if (Array.isArray(input)) {
    const items: unknown[] = input;
    return items.length;
  }
  if (!(typeof input === "string")) {
    return 0;
  }
  const text: string = input;
  return text.length;
}
```

The narrowed value is a fresh `const` annotated with the narrowed type, never the original binding retyped, so scope validation rejects it outside its block. A subject that is not a binding is saved to a `const` first and evaluated once. `.elseGuard` passes the false branch's type to an `else` body.

The guards are `typeof_`, `notNullish`, `isArray`, `in_`, `hasOwn`, discriminant `eq`, `instanceOf`, `predicate`, and `and`. Each narrowed type equals what TypeScript infers, which is not always set subtraction: `Object.hasOwn` does not narrow, optional properties stay in both branches of `in`, and a failed `typeof x === "object"` on `unknown` leaves `{} | undefined`. A guard whose narrowing cannot be reproduced exactly fails type checking. Refinements over the narrowed value, guarded `elseIf` chains, a narrowed `Stmt.guard` failure body, and a recursive exit check for that body are tracked in issues [61](https://github.com/saiashirwad/ts-macros/issues/61) through [64](https://github.com/saiashirwad/ts-macros/issues/64).

## Read a property with a runtime key

`Expr.prop` checks known property keys through TypeScript. For a runtime key whose field type is known during generation, `Expr.checkedProp` verifies a type descriptor.

```ts
const { row } = Expr.paramBindings([
  Expr.param("row", Type.object({ age: Type.number, name: Type.string })),
])
const key: string = "age"
const age = Expr.checkedProp(row, key, Type.number)
const adult = Expr.gte(age, 18)
```

`checkedProp` requires concrete object metadata and an own, required field. The field descriptor must equal the supplied descriptor structurally. Missing metadata, missing fields, optional fields, and mismatched descriptors throw during generation. The returned expression retains the supplied type, so comparing `age` with a string fails TypeScript checking.

The current emitters still require identifier-shaped property keys. A key such as `"first-name"` passes descriptor checking but fails emission, tracked in [issue 56](https://github.com/saiashirwad/ts-macros/issues/56).

The operation reads properties. It does not grant assignment access or add checks to the emitted JavaScript. Exact descriptor equality is stricter than assignability. An enum field accepts an equivalent enum descriptor, but a broad `Type.string` descriptor fails. Symbolic object types do not supply concrete field metadata. Native method calls can also lose descriptor precision. An explicit, statically checked declaration annotation can restore metadata, as the memq lowerer does for `slice`.

The [memq example](examples/memq/demo.ts) preserves column descriptors through predicates, selections, and ordering. Its lowerer uses the typed constructors and `checkedProp`, and rejects foreign columns or conflicting placeholder descriptors before emission. This checks generated operations. `memdb` still accepts object rows without schema validation, and execution parameters have a broad scalar record type. The example does not validate that those inputs match the declared schema or placeholder types. [Issue 55](https://github.com/saiashirwad/ts-macros/issues/55) tracks that execution API gap. Its dynamically known row and output shapes have conservative `Record<string, Scalar>` denotations; column witnesses prove each primitive property read during generation.

The [compiled validation example](examples/validation/README.md) turns a finite schema tree into specialized JavaScript branches and loops. Its demo uses inferred output types, accumulated error paths, `parse`, `safeParse`, and printable source. The example documents the runtime helpers and the compiler contract behind its inferred public return type.
