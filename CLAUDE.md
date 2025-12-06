# ts-macros

Typed macro system for TypeScript. `.macro.ts` → `.generated.ts` with full type inference during authoring.

## Architecture

```
DSL (dsl.ts)          → Ergonomic API, phantom-typed refs
    ↓
IR (ir.ts)            → Babel-shaped AST nodes, branding
    ↓
Babel (babel.ts)      → IR → Babel AST → code string
```

**Core files:**
- `ir.ts` - Expression/Statement/TSTypeDescriptor unions + `brand()`, `isExpr()`
- `babel.ts` - `expressionToBabel()`, `statementToBabel()`, `typeDescriptorToTSType()`
- `dsl.ts` - `$` namespace, `numeric`, `compare`, `str`, `logic`, `type` builders
- `refs.ts` - `VarRef<T>`, `TypeRef<T>`, `ClassRef<T>` with phantom types
- `types.ts` - `InferType`, `InferValueType`, `InferTSType`, `TypedExpression<T>`
- `infer.ts` - `normalizeToExpression()`, `inferExpressionType()`, registries

## Core Patterns

### 1. Generator-based DSL
Statements yield from generators, return typed refs:
```ts
*const<const V>(name: string, value: V): Generator<Statement, VarRef<InferValueType<V>>, any> {
  const expr = normalizeToExpression(value);
  yield { type: "const", name, value: expr, tsType: inferExpressionType(expr) };
  return new VarRef<InferValueType<V>>(name);
}
```

### 2. Expression Branding
All IR expressions branded to distinguish from plain objects:
```ts
export const ExprBrand = Symbol("Expr");
export function brand<T>(expr: T): Branded<T> { return { ...expr, [ExprBrand]: true } as any; }
```
**Always `brand()` new expressions in dsl.ts. Check with `isExpr()` in infer.ts.**

### 3. Phantom Types
Refs carry type info without runtime cost:
```ts
class VarRef<T> {
  declare readonly __type: T;  // phantom - never assigned
  constructor(public name: string, public tsType?: TSTypeDescriptor) {}
}
```

### 4. Inference Philosophy
**"Unknown over wrong"** - When inference fails, return `unknown`, not `any`. User escapes via `$.as<T>()`.

## Adding New Constructs

### New Expression
1. **ir.ts**: Add to `Expression` union
```ts
| { type: "my-expr"; arg: Expression }
```

2. **babel.ts**: Add case in `expressionToBabel()`
```ts
case "my-expr":
  return t.someExpression(expressionToBabel(expr.arg));
```

3. **dsl.ts**: Add builder in `$` that returns `TypedExpression<T>`
```ts
myExpr: <T>(arg: VarRef<T> | TypedExpression<T>): TypedExpression<T> => {
  const expr: Expression = brand({
    type: "my-expr",
    arg: arg instanceof VarRef ? brand({ type: "variable", name: arg.name }) : arg
  });
  return typedExpr<T>(expr);
}
```

4. **infer.ts**: Add case in `inferExpressionType()` if needed

5. **index.test.ts**: Add test

### New Statement
Same pattern but:
- Add to `Statement` union in ir.ts
- Add case in `statementToBabel()` in babel.ts
- DSL method is a generator (`function*`) yielding `Statement`

### New Type Descriptor
1. Add to `TSTypeDescriptor` union in ir.ts
2. Add case in `typeDescriptorToTSType()` in babel.ts
3. Add builder in `types` object in infer.ts
4. Export from `type` in dsl.ts

## Normalization Pattern
In DSL methods, normalize inputs before building IR:
```ts
const normalized =
  value instanceof VarRef ? brand({ type: "variable", name: value.name })
  : typeof value === "string" ? brand({ type: "literal", value })
  : typeof value === "number" ? brand({ type: "literal", value })
  : typeof value === "boolean" ? brand({ type: "literal", value })
  : value as Expression;
```
Or use `normalizeToExpression()` from infer.ts for complex cases.

## Current Gaps

| Category | Missing |
|----------|---------|
| Expressions | `destructure-array`, `destructure-object` |
| Types | conditional, mapped, keyof, typeof, indexed-access, template-literal, infer, index-signature, readonly |
| Compiler | Parse phase, derive builder, sandbox vm, source maps, CLI watch/build |

## Compiler (Planned)

Two modes per export:
- **Derive mode** (parsed, not executed): `derive(User).extend().omit()` chains
- **Generator mode** (sandboxed): `$.block(function*...)` execution

Pipeline: Parse `.macro.ts` → classify exports → type extraction → transform → codegen → write `.generated.ts` + `.map`

## Testing

```bash
bun test           # run tests
bun test:watch     # watch mode
```

Test pattern - generate code, check output string:
```ts
test("my feature", () => {
  const block = $.block(function* () {
    // DSL usage
  }).toBabelAST();
  const { code } = generate(block);
  expect(code).toContain("expected output");
});
```

## Anti-patterns

- ❌ Forgetting to `brand()` new expressions
- ❌ Returning `any` instead of `unknown` when inference fails
- ❌ Adding Babel translation without corresponding IR type
- ❌ Complex inference that could be wrong - prefer escape hatch
- ❌ Mutating expressions after creation

## Type Inference Limits

Inference works for:
- Literals, objects, arrays, VarRef types, function params/returns
- Basic generics with explicit type params
- Class/enum member shapes

Inference does NOT cover (use `.as<T>()`):
- Conditional types, mapped types, complex generics
- Dynamic/computed constructs
- Cross-file type resolution (needs TS Program)

## Commands

```bash
bun install        # install deps
bun test           # run tests
bun tsc --noEmit         # typecheck
```
