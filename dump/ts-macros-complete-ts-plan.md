# Extend ts-macros for Complete TypeScript Codegen

## Goal
Ergonomic DSL for TS codegen that feels close to writing real TS, with good editor experience while authoring macros.

## Core Principle

**Emit vs Infer separation:**
- **Output layer (Babel):** Can emit ANY TS construct - conditional types, mapped types, decorators, whatever
- **Inference layer (phantom types):** Only infers through a practical subset - enough for good DX

This keeps editor feedback immediate while avoiding reimplementing the TS type checker.

## What Gets Inferred (Phantom Types)

| Construct | Inference |
|-----------|-----------|
| Literals | ✓ Exact types (`"foo"` → `"foo"`, `42` → `42`) |
| Objects | ✓ Full shape (`{ a: 1 }` → `{ a: number }`) |
| Arrays/Tuples | ✓ Element types |
| VarRef | ✓ Carries declared type |
| ClassRef | ✓ Known member shapes |
| EnumRef | ✓ Member values |
| Function params/returns | ✓ From explicit type annotations |
| Basic generics | ✓ When type params are explicit |

**Policy: "Unknown over wrong"** - When inference fails or hits complexity limits, return `unknown` not `any`. User can always `$.as<T>()` to override.

## What Doesn't Get Inferred (Escape Hatch)

For complex types, user provides explicit annotation:

```ts
// Complex expression - provide type manually
const x = yield* $.const("x", complexExpr, type.number());
//                                         ^^^^^^^^^ escape hatch

// Advanced type in output - no inference needed, just emit
yield* $.type("Foo", type.conditional(
  type.reference("T"),
  type.string(),
  type.number(),
  type.boolean()
));
// Emits: type Foo = T extends string ? number : boolean
// No phantom type inference through conditionals - just codegen
```

## Current State

**Supported:**
- Expressions: literals, variables, binary/unary ops, calls, members, arrays, objects, templates, await
- Statements: let/const, if, for-of, return, functions, type aliases, interfaces
- Types: primitives, array, union, intersection, function, object, generic, reference, literal, tuple

**Gaps (Must-Have for Codegen):**

| Category | Missing |
|----------|---------|
| Expressions | ternary, spread, optional chaining, nullish, new, this, arrow, as/satisfies, update (`++`/`--`), tagged templates, destructuring |
| Statements | class, enum, switch, try/catch, while, break/continue, throw, namespace |
| Modules | import, export (named/default/all) |
| Advanced Types | conditional, mapped, keyof, typeof, indexed access, template literal, infer, index signatures, readonly modifiers |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  DSL Layer (src/dsl.ts)                                 │
│  - Ergonomic API: $.const, $.class, $.function, etc.    │
│  - Returns phantom-typed refs: VarRef<T>, ClassRef<T>   │
│  - Inference for practical subset only                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  IR Layer (src/ir.ts)                                   │
│  - Babel-shaped AST nodes                               │
│  - No type inference - just structure                   │
│  - Supports ALL TS constructs                           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Babel Translation (src/babel.ts)                       │
│  - IR → Babel AST                                       │
│  - generate() → TS code string                          │
└─────────────────────────────────────────────────────────┘
```

## Phases

### Phase 1: Extend IR (`src/ir.ts`)

**New expressions:**
```ts
| { type: "conditional"; test: Expression; consequent: Expression; alternate: Expression }
| { type: "spread"; argument: Expression }
| { type: "new"; callee: Expression; arguments: Expression[] }
| { type: "this" }
| { type: "arrow"; params: Param[]; body: Expression | Statement[]; async?: boolean }
| { type: "ts-as"; expression: Expression; typeAnnotation: TSTypeDescriptor }
| { type: "ts-satisfies"; expression: Expression; typeAnnotation: TSTypeDescriptor }
| { type: "ts-non-null"; expression: Expression }
| { type: "optional-member"; object: Expression; property: string; computed?: boolean }
| { type: "optional-call"; callee: Expression; arguments: Expression[] }
| { type: "nullish"; left: Expression; right: Expression }
| { type: "update"; operator: "++" | "--"; argument: Expression; prefix: boolean }
| { type: "tagged-template"; tag: Expression; quasi: TemplateLiteral }
| { type: "assignment"; operator: "=" | "+=" | ...; left: Expression; right: Expression }
| { type: "destructure-array"; elements: (Expression | null)[]; rest?: Expression }
| { type: "destructure-object"; properties: { key: string; value: Expression }[]; rest?: Expression }
```

**New statements:**
```ts
| { type: "class"; id: string; superClass?: Expression; implements?: TSTypeDescriptor[]; body: ClassMember[]; abstract?: boolean; typeParams?: TypeParam[] }
| { type: "enum"; id: string; members: { name: string; value?: Expression }[]; const?: boolean }
| { type: "switch"; discriminant: Expression; cases: { test: Expression | null; body: Statement[] }[] }
| { type: "try"; block: Statement[]; handler?: { param: string; body: Statement[] }; finalizer?: Statement[] }
| { type: "while"; test: Expression; body: Statement[] }
| { type: "do-while"; test: Expression; body: Statement[] }
| { type: "throw"; argument: Expression }
| { type: "break"; label?: string }
| { type: "continue"; label?: string }
| { type: "import"; source: string; specifiers: ImportSpec[]; typeOnly?: boolean }
| { type: "export-named"; declaration?: Statement; specifiers?: ExportSpec[]; source?: string; typeOnly?: boolean }
| { type: "export-default"; declaration: Expression | Statement }
| { type: "export-all"; source: string; exported?: string }
| { type: "namespace"; id: string; body: Statement[]; declare?: boolean }
```

**New type descriptors (for codegen, not inference):**
```ts
| { kind: "conditional"; checkType: T; extendsType: T; trueType: T; falseType: T }
| { kind: "mapped"; typeParam: TypeParam; type: T; readonly?: "+" | "-" | true; optional?: "+" | "-" | true }
| { kind: "indexed-access"; objectType: T; indexType: T }
| { kind: "keyof"; type: T }
| { kind: "typeof"; argument: string }
| { kind: "infer"; name: string }
| { kind: "template-literal"; quasis: string[]; types: T[] }
| { kind: "index-signature"; keyType: T; valueType: T; readonly?: boolean }
| { kind: "readonly"; type: T }
```

### Phase 2: Babel Translation (`src/babel.ts`)

Add cases for all new IR nodes. Straightforward 1:1 mapping.

### Phase 3: DSL (`src/dsl.ts`)

**Expressions:**
```ts
$.ternary(test, consequent, alternate)  // infers T | F
$.spread(expr)                          // infers ...T
$.new(Ctor, args)                       // infers instance type if Ctor is ClassRef
$.this                                  // no inference (context-dependent)
$.arrow(params, body)                   // infers (P) => R
$.as(expr, type)                        // infers provided type
$.satisfies(expr, type)                 // keeps original inference
$.nonNull(expr)                         // removes null/undefined from type
$.optional.prop(obj, "key")             // infers T | undefined
$.optional.call(fn, args)               // infers R | undefined
$.nullish(left, right)                  // infers T | F
```

**Classes (with inference):**
```ts
const MyClass = yield* $.class("MyClass", {
  extends: BaseClass,        // optional
  implements: [Interface],   // optional
  typeParams: ["T"],         // optional
}, function*() {
  yield* $.property("name", type.string());
  yield* $.property("count", type.number(), { static: true, readonly: true });
  yield* $.method("greet", { name: type.string() }, type.void(), function*({ name }) {
    // method body
  });
  yield* $.constructor({ name: type.string() }, function*({ name }) {
    // constructor body
  });
});
// MyClass: ClassRef<{ name: string, count: number, greet(name: string): void }>
```

**Enums:**
```ts
const Status = yield* $.enum("Status", {
  Pending: 0,
  Active: 1,
  Completed: 2,
});
// Status: EnumRef<{ Pending: 0, Active: 1, Completed: 2 }>
```

**Control flow (no special inference):**
```ts
yield* $.switch(value, [
  [1, function*() { ... }],
  [2, function*() { ... }],
  [null, function*() { ... }],  // default case
]);

yield* $.try(function*() { ... }, {
  catch: { param: "e", body: function*() { ... } },
  finally: function*() { ... },
});

yield* $.while(condition, function*() { ... });
yield* $.throw(expr);
yield* $.break();
yield* $.continue();
```

**Modules:**
```ts
yield* $.import("react", [
  { name: "React", kind: "default" },
  { name: "useState", kind: "named" },
  { name: "FC", kind: "type" },
]);

yield* $.import.namespace("lodash", "_");

yield* $.export.named(myVar, myFunc);
yield* $.export.default(MyClass);
yield* $.export.all("./utils");
yield* $.export.type(MyType);
```

**Advanced types (codegen only, no inference through them):**
```ts
type.conditional(check, extends_, trueType, falseType)
type.mapped({ name: "K", constraint: type.keyof(T) }, valueType, { readonly: true })
type.indexedAccess(objType, keyType)
type.keyof(objType)
type.typeof("varName")
type.infer("U")
type.templateLiteral(["prefix-", "-suffix"], [type.string()])
```

### Phase 4: Refs (`src/refs.ts`)

```ts
export class ClassRef<T = any> {
  declare readonly __tag: "ClassRef";
  declare readonly __type: T;
  constructor(public name: string, public typeParams?: string[]) {}
}

export class EnumRef<T extends Record<string, number | string> = any> {
  declare readonly __tag: "EnumRef";
  declare readonly __type: T;
  constructor(public name: string) {}
}
```

### Phase 5: Type Inference (`src/types.ts`)

Only add inference for the practical subset:

```ts
// Infer class member types from property/method definitions
type InferClassShape<Members extends readonly ClassMemberDef[]> = {
  [M in Members[number] as M extends { key: infer K extends string } ? K : never]:
    M extends { kind: "property"; tsType: infer T } ? InferTSType<T>
    : M extends { kind: "method"; params: infer P; returnType: infer R } ? (...args: InferParams<P>) => InferTSType<R>
    : never
};

// Infer enum shape from member definitions
type InferEnumShape<Members extends Record<string, number | string>> = Members;
```

**Escape hatch pattern:**
```ts
// When inference fails or is too complex, allow explicit annotation
function $.const<N extends string, V, T = InferValueType<V>>(
  name: N,
  value: V,
  explicitType?: TSTypeDescriptor  // overrides inference
): Generator<Statement, VarRef<T>, void>
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/ir.ts` | Add expression/statement/type variants |
| `src/babel.ts` | Add translation cases |
| `src/dsl.ts` | Add DSL methods with appropriate inference |
| `src/refs.ts` | Add ClassRef, EnumRef |
| `src/types.ts` | Inference for practical subset only |

## Execution Order

1. **Expressions** - ternary, spread, new, this, arrow, optional chaining, nullish, as/satisfies
2. **Classes** - full class support with member type inference
3. **Modules** - import/export
4. **Control Flow** - switch, try/catch, while, throw, break/continue
5. **Enums** - with value type inference
6. **Advanced Types** - codegen only (conditional, mapped, etc.)
7. **Tests**

## Key Design Decisions

1. **Phantom types for DX** - Editor sees types immediately while authoring
2. **Explicit escape hatch** - Complex cases use manual type annotation
3. **Codegen ≠ Inference** - Can emit any TS, only infer through subset
4. **Babel-shaped IR** - Easy to extend, minimal translation bugs
5. **No LanguageService** - Keeps it simple, editor-friendly, no runtime dependency
6. **Unknown over wrong** - Inference failures → `unknown`, not `any`
7. **Simple hygiene** - Track names in scope during generation (Set-based, no LS)

---

## Macro Service (Rust-like UX)

### Goal
Provide Rust-like macro experience: type errors in generated code map back to macro call sites.

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ user.macro.ts   │────▶│  Macro Service   │────▶│ user.generated.ts│
│ (macro calls)   │     │  (bun --watch)   │     │ (real TS code)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  TS Lang Server │
                                                 │  (full checking)│
                                                 └─────────────────┘
```

### CLI Interface

```bash
ts-macros watch              # dev mode - file watcher
ts-macros build --outDir .   # CI mode - one-shot
ts-macros build --tsc-check  # CI + run tsc --noEmit on outputs
```

### Watcher Implementation

**Core requirements:**
```ts
// src/cli/watch.ts
- Debounce per file (avoid double-regen on atomic saves)
- Batch changes per tick (don't hammer LS on format saves)
- Incremental writes (skip if code unchanged)
- Clear import cache per run (fresh vm context)
- Isolated execution (no shared globals between runs)
```

**Isolation & Safety:**
```ts
// Run macros in sandboxed vm
- Minimal allowed modules: fs, path, url (read-only fs?)
- Block process.exit, network access
- Time/CPU guard with configurable timeout
- Report timeouts cleanly
```

**Error handling:**
```ts
// Pretty-print macro runtime errors
- Stack traces with source maps back to .macro.ts
- Clear error boundaries between macro files
- Don't crash watcher on single macro failure
```

**Optional optimizations:**
```ts
- Build graph: only re-run macros whose deps changed
- Worker thread for big macros (don't block edits)
```

### Output Hygiene

**File structure:**
```
src/
  user.macro.ts          # input (checked in)
  user.generated.ts      # output (gitignored)
  user.generated.d.ts    # optional type twin
  user.generated.ts.map  # source map for error mapping
```

**Generated file header:**
```ts
// @generated - DO NOT EDIT
// Source: user.macro.ts
//# sourceMappingURL=user.generated.ts.map
```

**Git:**
```gitignore
# .gitignore
*.generated.ts
*.generated.d.ts
*.generated.ts.map
```

### TypeScript Integration

**tsconfig.json considerations:**
```json
{
  "include": ["src/**/*.ts", "src/**/*.generated.ts"],
  "exclude": ["node_modules"]
}
```

- Keep generated files within rootDir
- Don't compile .macro.ts to output (they're build-time only)
- If users use path aliases, resolve with ts.resolveModuleName

### Source Maps

Critical for "errors map back to macro call sites":

```ts
// When generating code, track source positions
const sourceMap = new SourceMapGenerator({ file: "user.generated.ts" });

// Each generated node maps back to macro.ts location
sourceMap.addMapping({
  generated: { line: 10, column: 0 },
  source: "user.macro.ts",
  original: { line: 5, column: 2 },  // the $.class() call
  name: "User"
});
```

TS 5.x understands source maps for JS/TS transforms - diagnostics and go-to-definition will jump to macro call sites.

### Implementation Phases

**Phase 1: Basic watcher**
- File watching with debounce
- Import + execute macro
- Write generated.ts with banner
- Basic error reporting

**Phase 2: Isolation + safety**
- vm sandbox with module allowlist
- Timeout guard
- Cache busting

**Phase 3: Source maps**
- Track positions during IR construction
- Emit .map files
- Verify TS server picks them up

**Phase 4: Optimizations**
- Incremental writes (hash comparison)
- Dependency graph
- Worker threads

### v2: Rust-like hover (future)

Thin TS LS plugin that:
- Intercepts hover/peek requests on .macro.ts
- Returns virtual expansion
- Maps locations back to macro source

Not needed for v1 - file watcher + source maps gets 90% of value.

---

## Macro Compiler Architecture

### Two Modes

| Mode | How it works | Use case |
|------|--------------|----------|
| **Derive Mode** | Parsed as AST, not executed | Type derivation, transformations |
| **Generator Mode** | Executed in sandbox | Imperative codegen, control flow |

### Derive Mode (Parsed, Not Executed)

```ts
// user.macro.ts
import { User } from './user'
import { derive } from 'ts-macros'

// Parsed as AST - never executed
export const UserWithAge = derive(User)
  .extend({ age: type.number() })
  .omit('password')

export const CreateUserInput = derive(User)
  .omit('id', 'createdAt')
  .partial('email')
```

**Contract for derive-mode:**
- Must be top-level exports
- Side-effect free
- Limited to allowed combinators: `.extend()`, `.omit()`, `.pick()`, `.partial()`, `.required()`
- Reject dynamic constructs: computed property keys, ternaries, function calls (except type builders)
- Deterministic: same input = same output

**Compiler rejects:**
```ts
// ❌ Dynamic property key
derive(User).extend({ [someVar]: type.string() })

// ❌ Ternary in chain
derive(User)[condition ? 'omit' : 'pick']('id')

// ❌ Not top-level
function makeDerive() { return derive(User).extend(...) }
```

### Generator Mode (Sandbox Executed)

```ts
// api.macro.ts
import { $, type } from 'ts-macros'

// Executed in sandboxed vm
export default function*() {
  const userType = yield* $.extractType("./user.ts", "User");

  yield* $.function("validateUser",
    { data: type.unknown() },
    type.reference(`data is User`),
    function*({ data }) {
      // Dynamic logic based on extracted type
      for (const [key, propType] of Object.entries(userType.properties)) {
        yield* $.if($.not(checkProp(data, key, propType)), function*() {
          yield* $.return($.bool(false));
        });
      }
      yield* $.return($.bool(true));
    }
  );
}
```

**Sandbox constraints:**
- Worker vm with module allowlist
- Time/CPU budget (configurable timeout)
- Cache-busted imports (fresh context per run)
- No process.exit, network access, or global mutation

### Hybrid Files

Each export handled independently:

```ts
// both.macro.ts
import { User } from './user'
import { derive, $ } from 'ts-macros'

// Derive mode (parsed)
export const UserWithAge = derive(User).extend({ age: type.number() })

// Generator mode (executed)
export const validators = $.block(function*() {
  yield* $.function("customValidator", ...);
})
```

Compiler walks file, classifies each export:
- `derive(...)` chain → parse mode
- `$.block(function*...)` or `function*` default export → generator mode
- Unknown pattern → error with clear message

### Memory Representation (MacroOp Schema)

```ts
// src/compiler/ops.ts - versioned for future codemods
export const SCHEMA_VERSION = 1;

type MacroOp =
  | DeriveOp
  | BlockOp

interface DeriveOp {
  kind: "derive";
  version: typeof SCHEMA_VERSION;
  exportName: string;
  source: { file: string; typeName: string };
  chain: DeriveChainStep[];
  loc: SourceLocation; // for source maps
}

type DeriveChainStep =
  | { op: "extend"; props: Record<string, TSTypeDescriptor>; loc: SourceLocation }
  | { op: "omit"; keys: string[]; loc: SourceLocation }
  | { op: "pick"; keys: string[]; loc: SourceLocation }
  | { op: "partial"; keys?: string[]; loc: SourceLocation }
  | { op: "required"; keys?: string[]; loc: SourceLocation }

interface BlockOp {
  kind: "block";
  version: typeof SCHEMA_VERSION;
  exportName: string;
  statements: Statement[]; // Our IR
  loc: SourceLocation;
}

interface SourceLocation {
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}
```

### Type Extraction API

Host-side (read-only TS program):
```ts
// src/compiler/extract.ts
export function extractType(
  program: ts.Program,
  file: string,
  typeName: string
): TSTypeDescriptor {
  const checker = program.getTypeChecker();
  // ... extraction logic
}
```

Generator-mode façade (exposed to user code):
```ts
// Available in sandbox as $.extractType
const userType = yield* $.extractType("./user.ts", "User");
// Returns TSTypeDescriptor, not raw TS types
// Users never touch TypeChecker directly
```

### Compiler Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                     Macro Compiler                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Parse Phase                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Walk .macro.ts AST                                    │   │
│  │ Classify exports: derive vs generator                 │   │
│  │ Build MacroOp[] with source locations                 │   │
│  │ Reject invalid derive constructs early                │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  2. Type Extraction Phase                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Create TS Program (cached, incremental)               │   │
│  │ Extract source types for derive ops                   │   │
│  │ Expose $.extractType for generator ops                │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  3. Transform Phase                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Derive ops: apply chain to extracted types            │   │
│  │ Generator ops: execute in sandbox vm                  │   │
│  │ Collect IR statements from both                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  4. Codegen Phase                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ IR → Babel AST                                        │   │
│  │ Babel AST → code string                               │   │
│  │ Generate source maps (macro loc → generated loc)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  5. Output Phase                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Write .generated.ts with header                       │   │
│  │ Write .generated.ts.map                               │   │
│  │ Incremental: skip if unchanged                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Source Maps Through Both Modes

Every MacroOp and IR node carries `loc: SourceLocation` from the original .macro.ts:

```ts
// Derive mode: location from AST parse
{ op: "extend", props: {...}, loc: { file: "user.macro.ts", start: {line: 5, col: 3}, ... } }

// Generator mode: location captured during execution
yield* $.function("foo", ...) // captures caller location via Error.stack or explicit tracking
```

Generated source map connects:
```
user.generated.ts:10:0  →  user.macro.ts:5:3  (the .extend() call)
user.generated.ts:15:0  →  user.macro.ts:12:2 (the $.function() call)
```

TS errors in generated code show macro file locations.

### Derive Builder Types (Editor DX)

```ts
// src/derive.ts - gives autocomplete while writing macros
interface DeriveBuilder<T, Source = T> {
  extend<E extends Record<string, TSTypeDescriptor>>(
    props: E
  ): DeriveBuilder<T & InferShape<E>, Source>

  omit<K extends keyof T>(
    ...keys: K[]
  ): DeriveBuilder<Omit<T, K>, Source>

  pick<K extends keyof T>(
    ...keys: K[]
  ): DeriveBuilder<Pick<T, K>, Source>

  partial(): DeriveBuilder<Partial<T>, Source>
  partial<K extends keyof T>(...keys: K[]): DeriveBuilder<PartialBy<T, K>, Source>

  required(): DeriveBuilder<Required<T>, Source>
  required<K extends keyof T>(...keys: K[]): DeriveBuilder<RequiredBy<T, K>, Source>
}

// Usage gets full autocomplete:
derive(User)
  .omit('password', 'hash')  // ← autocomplete shows User keys
  .extend({ age: type.number() })
  .partial('email')  // ← autocomplete shows remaining keys
```

### Schema Versioning

```ts
// For future migrations
export const SCHEMA_VERSION = 1;

// When schema changes:
// 1. Bump version
// 2. Write codemod: v1 MacroOp[] → v2 MacroOp[]
// 3. Detect old cached .macro-cache files, migrate or invalidate
```
