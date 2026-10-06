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
console.log(person.safeParse({ name: "", age: -1 }))
console.log(person.toCode())
```

Run `node examples/validation/demo.ts` from the repository root.

`schema.string(minLength)` requires a nonnegative safe integer length. `schema.number(min, integer)` accepts finite numbers and optionally checks a lower bound and integer values. `schema.literal(value)` accepts a finite number, string, boolean, or null. There is no coercion.

Objects read own properties and strip extra fields. Missing optional fields stay absent. An own optional field explicitly set to `undefined` stays present. Output objects have `Object.prototype`, including when a schema declares a computed `"__proto__"` field. Nested failures accumulate in schema field order and array index order. A wrong container produces one issue and skips its descendants. `parse` throws `ValidationError`; `safeParse` returns a tagged result. Exceptions thrown by input getters or proxies still propagate.

`schema.ts` describes an immutable schema tree and derives output types. Object schemas require a plain field object with own enumerable string data properties. Symbol keys, inherited fields, nonenumerable fields, and accessors are rejected before compilation so inferred fields cannot disappear. Passing a schema whose static type has been erased to the general `Schema` union produces `unknown`, since its particular output shape is no longer known.

`compile.ts` traverses that tree once and creates a function with typed `T` constructors (`$.fn`, `$.if`, guards, expressions, and the rest). Object fields become fixed statements, arrays become loops, and errors allocate their path only in a failing branch. The generated function never traverses a schema. This example adds no library API.

`$.isTypeof` and `$.isArray` introduce fresh typed aliases through `$.ifGuard`. String length and number constraints set a boolean through those aliases, followed by one success/failure branch. Object branches combine `$.isTypeof` and `$.notNullish` with `$.allOf`, exclude arrays, and use a boolean to report container failure once. These flags avoid duplicate issue statements until a refinement over the narrowed value exists ([issue 61](https://github.com/saiashirwad/ts-macros/issues/61)). Optional values still check only `!== undefined`, so null reaches the inner schema. Null literals use `$.null()`.

`runtime.ts` exports a frozen helper object with `ownRead` and `defineOwn`. Optional field presence uses `$.hasOwn`, which emits `Object.hasOwn` without narrowing. `ownRead` checks ownership and returns `undefined` for missing or inherited fields, including required fields. It retains an internal `isObject` check and accepts unknown input. Combining `$.in` with `$.hasOwn` would type direct field reads, but adds a proxy `has` trap and can change the result or throw; the checked reader preserves existing proxy behavior. `defineOwn` safely creates fields including `"__proto__"`. No helper interprets a schema.

`toCode()` returns exactly the JavaScript function body passed to `new Function`. It ends with `return validate;` and requires the exported `runtime` binding.

```ts
import { runtime } from "./runtime.ts"

const validate = new Function("runtime", person.toCode())(runtime)
console.log(validate({ name: "Ada", age: 36 }))
```

The emitted IR uses narrowed types for guarded aliases and `unknown` for output accumulators, checked field reads, and success data. TypeScript checks every AST operation, but it does not prove that this compiler implements `Infer<S>`. The public generic overload promises that relationship, and one assertion types the evaluated JavaScript function. The schema traversal and generated validation checks must establish the inferred output before returning success. The compiler itself makes no assertions about expression denotations and uses no `any` aliases. Runtime tests defend that evaluation boundary; compile-time tests check required and optional output fields.

The repository lint rules normally ban explicit unknown parameters and returns, even at a parser boundary. Focused overrides permit unknown parameters in `compile.ts` and `runtime.ts`, and unknown returns and a record of unknown values in the checked runtime reader. Assertions still require the existing safety comment, and the remaining codegen rules apply.
