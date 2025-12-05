# ts-macros Implementation Guide

## File Structure

```
src/
  ir.ts          # Expression, Statement, TSTypeDescriptor types + branding
  babel.ts       # IR → Babel AST translation (expressionToBabel, statementToBabel, typeDescriptorToTSType)
  dsl.ts         # $ namespace, generators, type builders
  refs.ts        # VarRef<T>, TypeRef<T> classes with phantom types
  types.ts       # Phantom type inference (InferValueType, InferTSType, etc.)
  infer.ts       # Runtime type inference helpers
  index.ts       # Public exports

# To be added:
src/
  compiler/
    parse.ts       # AST walker, classify exports, build MacroOp[]
    extract.ts     # TS Program wrapper, type extraction
    transform.ts   # Apply derive chains, run generator sandbox
    codegen.ts     # IR → Babel → code + source maps
    ops.ts         # MacroOp schema (DeriveOp, BlockOp)
    sandbox.ts     # vm/worker isolation for generators
    validate.ts    # Structural validation (unbound vars, etc.)
    hygiene.ts     # Scoped name allocator
  derive/
    builder.ts     # DeriveBuilder<T> fluent API
    combinators.ts # extend, omit, pick, partial, required, merge, record
  cli/
    watch.ts       # File watcher with debounce
    build.ts       # One-shot build for CI
    index.ts       # CLI entry point
```

## Key Patterns

### 1. Expression Branding

All expressions are branded with a symbol to distinguish IR nodes from plain objects:

```ts
// ir.ts
export const ExprBrand = Symbol("Expr");
export type Branded<T> = T & { [ExprBrand]: true };

export function brand<T>(expr: T): Branded<T> {
  return { ...expr, [ExprBrand]: true } as any;
}

export function isExpr(x: unknown): x is Expression {
  return !!x && typeof x === "object" && ExprBrand in x;
}
```

### 2. Generator-based DSL

Statements are yielded from generators, returning typed refs:

```ts
// dsl.ts pattern
*const<const V>(
  name: string,
  value: V,
  tsType?: TSTypeDescriptor
): Generator<Statement, VarRef<InferValueType<V>>, any> {
  const expr = normalizeToExpression(value);
  const stmt: Statement = { type: "const", name, value: expr, tsType };
  yield stmt;
  return new VarRef<InferValueType<V>>(name, tsType);
}
```

### 3. Phantom Types on Refs

Refs carry type information via `declare` properties:

```ts
// refs.ts
export class VarRef<T = any> {
  declare readonly __tag: "VarRef";
  declare readonly __type: T;  // phantom - never assigned at runtime
  constructor(public name: string, public tsType?: TSTypeDescriptor) {}
}
```

### 4. Babel Translation

Switch on IR node type, return Babel AST:

```ts
// babel.ts pattern
function expressionToBabel(expr: Expression): t.Expression {
  switch (expr.type) {
    case "literal":
      return typeof expr.value === "string" ? t.stringLiteral(expr.value)
           : typeof expr.value === "number" ? t.numericLiteral(expr.value)
           : t.booleanLiteral(expr.value);
    case "variable":
      return t.identifier(expr.name);
    // ... etc
  }
}
```

## MacroOp Schema

```ts
// compiler/ops.ts
export const SCHEMA_VERSION = 1;

interface SourceLocation {
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

type MacroOp = DeriveOp | BlockOp;

interface DeriveOp {
  kind: "derive";
  version: typeof SCHEMA_VERSION;
  exportName: string;
  source: { file: string; typeName: string };
  chain: DeriveChainStep[];
  loc: SourceLocation;
}

type DeriveChainStep =
  | { op: "extend"; props: Record<string, TSTypeDescriptor>; loc: SourceLocation }
  | { op: "omit"; keys: string[]; loc: SourceLocation }
  | { op: "pick"; keys: string[]; loc: SourceLocation }
  | { op: "partial"; keys?: string[]; loc: SourceLocation }
  | { op: "required"; keys?: string[]; loc: SourceLocation }
  | { op: "merge"; other: { file: string; typeName: string }; loc: SourceLocation }
  | { op: "record"; keyType: TSTypeDescriptor; valueType: TSTypeDescriptor; loc: SourceLocation }

interface BlockOp {
  kind: "block";
  version: typeof SCHEMA_VERSION;
  exportName: string;
  generatorSource: string;  // raw source for sandbox execution
  loc: SourceLocation;
}
```

## DeriveBuilder Types

```ts
// derive/builder.ts
interface DeriveBuilder<T, Source = T> {
  extend<E extends Record<string, TSTypeDescriptor>>(
    props: E
  ): DeriveBuilder<T & InferShape<E>, Source>

  omit<K extends keyof T>(...keys: K[]): DeriveBuilder<Omit<T, K>, Source>
  pick<K extends keyof T>(...keys: K[]): DeriveBuilder<Pick<T, K>, Source>

  partial(): DeriveBuilder<Partial<T>, Source>
  partial<K extends keyof T>(...keys: K[]): DeriveBuilder<PartialBy<T, K>, Source>

  required(): DeriveBuilder<Required<T>, Source>
  required<K extends keyof T>(...keys: K[]): DeriveBuilder<RequiredBy<T, K>, Source>

  merge<U>(other: DeriveBuilder<U, any>): DeriveBuilder<T & U, Source>

  record<K extends string, V>(
    keyType: TSTypeDescriptor,
    valueType: TSTypeDescriptor
  ): DeriveBuilder<Record<K, V>, Source>
}

// Helper types
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
type InferShape<E> = { [K in keyof E]: InferTSType<E[K]> }
```

## Type Extraction

```ts
// compiler/extract.ts
import ts from "typescript";

export function extractType(
  program: ts.Program,
  filePath: string,
  typeName: string
): TSTypeDescriptor {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);

  // Find exported symbol by name
  const symbol = findExportedSymbol(sourceFile, typeName, checker);
  const type = checker.getDeclaredTypeOfSymbol(symbol);

  return tsTypeToDescriptor(checker, type);
}

function tsTypeToDescriptor(checker: ts.TypeChecker, type: ts.Type): TSTypeDescriptor {
  if (type.flags & ts.TypeFlags.String) return { kind: "primitive", name: "string" };
  if (type.flags & ts.TypeFlags.Number) return { kind: "primitive", name: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { kind: "primitive", name: "boolean" };

  if (type.isClassOrInterface() || (type.flags & ts.TypeFlags.Object)) {
    const properties: Record<string, TSTypeDescriptor> = {};
    for (const prop of type.getProperties()) {
      const propType = checker.getTypeOfSymbol(prop);
      properties[prop.getName()] = tsTypeToDescriptor(checker, propType);
    }
    return { kind: "object", properties };
  }

  if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0];
    return { kind: "array", elementType: tsTypeToDescriptor(checker, elementType!) };
  }

  if (type.isUnion()) {
    return { kind: "union", types: type.types.map(t => tsTypeToDescriptor(checker, t)) };
  }

  return { kind: "primitive", name: "unknown" };  // fallback
}
```

## Structural Validator

```ts
// compiler/validate.ts
interface ValidationError {
  message: string;
  loc: SourceLocation;
}

export function validateStatements(stmts: Statement[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const scope = new Set<string>();

  function walk(stmt: Statement, inFunction: boolean, inLoop: boolean) {
    switch (stmt.type) {
      case "const":
      case "let":
        if (scope.has(stmt.name)) {
          errors.push({ message: `Duplicate binding: ${stmt.name}`, loc: stmt.loc });
        }
        scope.add(stmt.name);
        validateExprRefs(stmt.value, scope, errors);
        break;

      case "return":
        if (!inFunction) {
          errors.push({ message: "return outside function", loc: stmt.loc });
        }
        break;

      case "break":
      case "continue":
        if (!inLoop) {
          errors.push({ message: `${stmt.type} outside loop`, loc: stmt.loc });
        }
        break;

      // ... etc
    }
  }

  for (const stmt of stmts) walk(stmt, false, false);
  return errors;
}
```

## Sandbox Execution

```ts
// compiler/sandbox.ts
import { VM } from "vm2";  // or isolated-vm

const ALLOWED_MODULES = ["fs", "path", "url", "crypto"];
const TIMEOUT_MS = 2000;

export async function executeGenerator(
  source: string,
  context: { $: typeof DSL; type: typeof typeBuilders; extractType: Function }
): Promise<Statement[]> {
  const vm = new VM({
    timeout: TIMEOUT_MS,
    sandbox: {
      ...context,
      console: { log: () => {}, warn: () => {}, error: () => {} },
    },
    require: {
      external: false,
      builtin: ALLOWED_MODULES,
    },
  });

  const generator = vm.run(`(${source})()`);
  const statements: Statement[] = [];

  for (const stmt of generator) {
    statements.push(stmt);
  }

  return statements;
}
```

## Source Map Generation

```ts
// compiler/codegen.ts
import { SourceMapGenerator } from "source-map";

export function generateWithSourceMap(
  statements: Statement[],
  macroFile: string
): { code: string; map: string } {
  const sourceMap = new SourceMapGenerator({ file: macroFile.replace(".macro.ts", ".generated.ts") });

  // Track line as we generate
  let generatedLine = 1;

  for (const stmt of statements) {
    if (stmt.loc) {
      sourceMap.addMapping({
        generated: { line: generatedLine, column: 0 },
        source: macroFile,
        original: { line: stmt.loc.start.line, column: stmt.loc.start.column },
      });
    }
    // ... generate code, increment generatedLine
  }

  return {
    code: generatedCode + `\n//# sourceMappingURL=${outputFile}.map`,
    map: sourceMap.toString(),
  };
}
```

## CLI Watcher

```ts
// cli/watch.ts
import { watch } from "fs";

const DEBOUNCE_MS = 100;
const pending = new Map<string, NodeJS.Timeout>();

export function startWatcher(pattern: string) {
  watch(pattern, { recursive: true }, (event, filename) => {
    if (!filename?.endsWith(".macro.ts")) return;

    // Debounce per file
    const existing = pending.get(filename);
    if (existing) clearTimeout(existing);

    pending.set(filename, setTimeout(() => {
      pending.delete(filename);
      processMacroFile(filename);
    }, DEBOUNCE_MS));
  });
}

async function processMacroFile(file: string) {
  try {
    const ops = await parseMacroFile(file);
    const statements = await transformOps(ops);
    const { code, map } = generateWithSourceMap(statements, file);

    const outFile = file.replace(".macro.ts", ".generated.ts");
    const existingHash = hashFile(outFile);
    const newHash = hash(code);

    if (existingHash !== newHash) {
      await writeFile(outFile, `// @generated - DO NOT EDIT\n// Source: ${file}\n${code}`);
      await writeFile(`${outFile}.map`, map);
    }
  } catch (err) {
    console.error(`Error processing ${file}:`, err);
  }
}
```

## What To Build (Priority Order)

1. **IR extensions** - Add missing expression/statement/type variants
2. **Babel translation** - Cases for all new IR nodes
3. **DSL extensions** - Builders for new constructs
4. **Derive mode** - Parser, DeriveBuilder, combinators
5. **Type extraction** - TS Program wrapper, tsTypeToDescriptor
6. **Generator sandbox** - vm isolation, timeout, allowlist
7. **Validation** - Structural checks pre-emit
8. **Source maps** - Location tracking, map generation
9. **CLI** - watch/build commands
10. **Tests** - Unit, snapshot, roundtrip
