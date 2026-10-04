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

## Narrow both branches of a guarded if

`Stmt.ifGuard` passes a fresh const binding to its successful branch. Its
`.elseGuard` method passes a separate const binding denoting the guard's native
TypeScript false-branch type:

```ts
yield * Stmt.ifGuard(Guard.typeof_(input, "string"), function*(text) {
  yield* Stmt.do_(text)
}).elseGuard(function*(rest) {
  yield* Stmt.do_(rest)
}, "rest")
```

The subject is evaluated once. The original stage-1 expression is not retyped.
The false branch follows TypeScript narrowing, not general set subtraction:
optional properties remain in both branches of `in`, and readonly arrays remain
in the false branch of `Array.isArray`. Most `typeof` false branches leave
`unknown` unchanged, but the `"object"` and `"undefined"` tags produce
`{} | undefined` and `{} | null`, respectively. A failed `notNullish` test on
`unknown` produces `null | undefined`.

Supported complements include `typeof_`, `notNullish`, `isArray`, discriminant
`eq`, finite-key object `in_`, and boolean-only `hasOwn`. `instanceOf` retains its
existing restriction to unknown, object, or nullable exact instance subjects.
Predicate complements accept non-nullish, non-top asserted types on unknown,
object subjects, or unions with exact asserted members; other overlaps are
rejected through a type-level check. `and` combines the left false branch with
the right false branch after applying the left refinement, propagating checks.
Partially overlapping false-branch unions are rejected, since TypeScript's
flow-union reduction can differ from the corresponding declared union.

An else branch closes the builder. Ordinary `elseIf` intentionally drops the
`.elseGuard` capability, since its additional narrowing is not modeled;
`elseIfGuard` and complement parameters for `Stmt.guard` failure bodies are not
implemented. You can use a nested guarded if inside `.elseGuard` instead.

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
