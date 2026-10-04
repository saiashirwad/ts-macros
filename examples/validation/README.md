# Compiled validation example

This example builds a validator from a small Zod-style schema. It supports strings, finite numbers, booleans, exact literals, arrays, objects, and optional values. It has no Zod dependency and does not claim Zod compatibility.

```ts
import { compile } from "./compile.ts"
import { schema } from "./schema.ts"

const Person = schema.object({
  name: schema.string(1),
  age: schema.number(0, true),
  nickname: schema.optional(schema.string()),
})
const person = compile(Person)
const value = person.parse({ name: "Ada", age: 36 })
// value has type { name: string; age: number; nickname?: string | undefined }.
console.log(person.safeParse({ name: "", age: -1 }))
console.log(person.toCode())
```

Run `node examples/validation/demo.ts` from the repository root.

`schema.string(minLength)` requires a nonnegative safe integer length. `schema.number(min, integer)` accepts finite numbers and optionally checks a lower bound and integer values. `schema.literal(value)` accepts a finite number, string, boolean, or null. There is no coercion.

Objects read own properties and strip extra fields. Missing optional fields stay absent. An own optional field explicitly set to `undefined` stays present. Output objects have `Object.prototype`, including when a schema declares a computed `"__proto__"` field. Nested failures accumulate in schema field order and array index order. A wrong container produces one issue and skips its descendants. `parse` throws `ValidationError`; `safeParse` returns a tagged result. Exceptions thrown by input getters or proxies still propagate.

`schema.ts` describes an immutable schema tree and derives output types. Object schemas require a plain field object with own enumerable string data properties. Symbol keys, inherited fields, nonenumerable fields, and accessors are rejected before compilation so inferred fields cannot disappear. Passing a schema whose static type has been erased to the general `Schema` union produces `unknown`, since its particular output shape is no longer known.

`compile.ts` traverses that tree once and creates a function with typed `Decl`, `Expr`, and `Stmt` constructors. Object fields become fixed statements, arrays become loops, and errors allocate their path only in a failing branch. The generated function never traverses a schema. This example adds no library API.

`runtime.ts` exports a frozen helper object with actual scalar checks, checked array access, own-property access, and safe output field creation. It accepts unknown input honestly. It cannot interpret a schema. The array reader repeats `Array.isArray` after the generated array gate. Scalar checks combine type and constraint checks in a helper because generated conditionals do not refine `Expr<unknown>` into a string or number expression.

The library currently has no null literal constructor. The null literal schema compares against the real `runtime.nullValue` property. `Expr.index` accepts arrays rather than string-keyed records, and `Expr.checkedProp` needs concrete object metadata that unknown input does not have. Generated branches also provide no staged control-flow narrowing. This example therefore uses checked runtime property readers instead of asserting a narrower staged expression type.

`toCode()` returns exactly the JavaScript function body passed to `new Function`. It ends with `return validate;` and requires the exported `runtime` binding.

```ts
import { runtime } from "./runtime.ts"

const validate = new Function("runtime", person.toCode())(runtime)
console.log(validate({ name: "Ada", age: 36 }))
```

The emitted IR uses `unknown` for intermediate values and success data. TypeScript checks every AST operation, but it does not prove that this compiler implements `Infer<S>`. The public generic overload promises that relationship, and one assertion types the evaluated JavaScript function. The schema traversal and generated validation checks must establish the inferred output before returning success. The compiler itself makes no assertions about `Expr` denotations and uses no `any` aliases. Runtime tests defend that evaluation boundary; compile-time tests check required and optional output fields.

The repository lint rules normally ban explicit unknown parameters and returns, even at a parser boundary. A focused override permits these types in `compile.ts` and `runtime.ts`. A second override permits a record of unknown values in the checked runtime reader. Assertions still require the existing safety comment, and the remaining codegen rules apply.
