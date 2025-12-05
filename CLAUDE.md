# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Typed macro system: `.macro.ts` → `.generated.ts` with **"extreme inference"** — invalid DSL combinations surface as TS errors in the macro file, not after generation.

**Philosophy:** IR/Babel emits full TS; inference covers practical subset (prefer `unknown` over wrong, `.as<T>()` escape hatch)

## Commands

```bash
bun test                    # run all tests
bun test src/index.test.ts  # single file
```

## Architecture

```
$.*() methods → yield IR → statementToBabel() → @babel/types → generate() → TS code
```

**Modules:**
- `ir.ts` — Expression/Statement/TSTypeDescriptor unions (runtime IR structure)
- `dsl.ts` — `$` object with generator methods + helpers (numeric, compare, str, logic, type)
- `babel.ts` — IR → Babel AST conversion
- `refs.ts` — `VarRef<T>`, `TypeRef<T>` with phantom types
- `types.ts` — TypedExpression, InferType/InferTSType (compile-time type extraction)
- `infer.ts` — `normalizeToExpression()`, `inferExpressionType()` (runtime inference)

## Macro Modes

**Generator mode** (current focus): Imperative `function*` that yields IR statements
```ts
function* myMacro() {
  const x = yield* $.const("x", 42);
  return x;
}
```

**Derive mode** (planned): Declarative chains parsed but not executed
```ts
export const UserDTO = derive(User).omit("password").extend({ createdAt: type.string() });
```
- Static keys/values only, no computed props or ternaries
- Combinators: extend/omit/pick/partial/required/merge/record

## Type System

**Two layers:**
- **Compile-time (TypeScript):** Phantom types carry full type info through DSL
- **Runtime (JavaScript):** TSTypeDescriptor describes structure for codegen

**Phantom types** in `VarRef<T>` / `TypeRef<T>`:
```ts
class VarRef<T> {
  declare readonly __type: T;  // never assigned, only for TS inference
}
```

**TSTypeDescriptor** (runtime type representation):
```ts
{ kind: "primitive", name: "string" }
{ kind: "array", elementType: TSTypeDescriptor }
{ kind: "object", properties: Record<string, TSTypeDescriptor> }
{ kind: "union", types: TSTypeDescriptor[] }
{ kind: "function", params: TSTypeDescriptor[], returnType: TSTypeDescriptor }
```

**InferType / InferTSType** — Extract TS type from IR at compile-time:
```ts
type InferTSType<{ kind: "primitive", name: "string" }> = string
type InferTSType<{ kind: "array", elementType: T }> = InferTSType<T>[]
```

## Critical Patterns

**1. Expression branding** — All IR objects must be wrapped with `brand()`:
```ts
brand({ type: "literal", value: 42 })  // ✓ recognized by isExpr()
{ type: "literal", value: 42 }          // ✗ raw object, will fail
```

**2. Generator yield*** — DSL methods are generators; must use `yield*`:
```ts
const x = yield* $.const("x", 42);  // ✓ yields statement, returns VarRef<number>
const x = yield $.const("x", 42);   // ✗ silently breaks statement collection
```

**3. Type inference fallback** — Unhandled cases return `types.unknown()`, not errors. Use `.as<T>()` for explicit typing.

**4. TypeRef auto-registration** — `$.type()` registers in `typeAliasRegistry` for subsequent inference.

## Extending the Codebase

**Adding new Expression type:**
1. `ir.ts`: Add to Expression union
2. `babel.ts`: Add case in `expressionToBabel()` switch
3. `dsl.ts`: Add method returning `TypedExpression<T>`

**Adding new Statement type:**
1. `ir.ts`: Add to Statement union
2. `babel.ts`: Add case in `statementToBabel()` switch
3. `dsl.ts`: Add generator method that yields statement, returns typed ref

**Adding new DSL method:**
```ts
*newMethod(args): Generator<Statement, VarRef<T>, any> {
  const expr = normalizeToExpression(value);  // convert JS → IR
  const stmt: Statement = { type: "...", ... };
  yield stmt;
  return new VarRef<T>(name, typeDescriptor);
}
```

## Testing

```ts
test("description", () => {
  const block = $.block(function* () {
    // build code with DSL
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("expected output");  // don't assert exact formatting
});
```

- Test branding: `expect(isExpr(branded)).toBe(true)`
- Test inference: check `inferExpressionType()` returns expected TSTypeDescriptor
