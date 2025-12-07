import type { Expression, TSTypeDescriptor } from "./ir";
import { isExpr, brand } from "./ir";
import { VarRef, TypeRef } from "./refs";
import type { TypedDescriptor, TypeInput, ExtractType, GenericTypeResult } from "./types";

function toDescriptor(t: TypeInput): TSTypeDescriptor {
  return t instanceof TypeRef ? t.toDescriptor() : t as TSTypeDescriptor;
}

const _t = {
  array: (elementType: TSTypeDescriptor): TSTypeDescriptor => ({ kind: "array", elementType }),
  union: (...types: TSTypeDescriptor[]): TSTypeDescriptor => ({ kind: "union", types }),
  object: (properties: Record<string, TSTypeDescriptor>): TSTypeDescriptor => ({ kind: "object", properties }),
};

const nonNullable = (type: TSTypeDescriptor): TSTypeDescriptor => {
  if (type.kind === "union") {
    return _t.union(...type.types.filter(t => !isNullishPrimitive(t)));
  }
  return isNullishPrimitive(type) ? types.never() : type;
};

const isNullishPrimitive = (type: TSTypeDescriptor): boolean => {
  return type.kind === "primitive" && (type.name === "null" || type.name === "undefined");
};

export const types = {
  string: () => ({ kind: "primitive", name: "string" }) as const,
  number: () => ({ kind: "primitive", name: "number" }) as const,
  boolean: () => ({ kind: "primitive", name: "boolean" }) as const,
  any: () => ({ kind: "primitive", name: "any" }) as const,
  void: () => ({ kind: "primitive", name: "void" }) as const,
  undefined: () => ({ kind: "primitive", name: "undefined" }) as const,
  null: () => ({ kind: "primitive", name: "null" }) as const,
  never: () => ({ kind: "primitive", name: "never" }) as const,
  unknown: () => ({ kind: "primitive", name: "unknown" }) as const,
  array: <T extends TypeInput>(elementType: T): TypedDescriptor<
    ExtractType<T>[],
    { kind: "array"; elementType: TSTypeDescriptor }
  > => ({ kind: "array", elementType: toDescriptor(elementType) }) as any,

  union: <T extends TypeInput[]>(...types: T): TypedDescriptor<
    ExtractType<T[number]>,
    { kind: "union"; types: TSTypeDescriptor[] }
  > => ({ kind: "union", types: types.map(toDescriptor) }) as any,

  intersection: <T extends TypeInput[]>(...types: T): TypedDescriptor<
    ExtractType<T[number]>,
    { kind: "intersection"; types: TSTypeDescriptor[] }
  > => ({ kind: "intersection", types: types.map(toDescriptor) }) as any,

  function: <P extends TSTypeDescriptor[], R extends TSTypeDescriptor>(params: P, returnType: R) => ({ kind: "function" as const, params, returnType }),

  object: <P extends Record<string, TypeInput | { type: TypeInput; optional?: boolean; readonly?: boolean }>>(properties: P): TypedDescriptor<
    { [K in keyof P]: ExtractType<P[K]> },
    { kind: "object"; properties: Record<string, TSTypeDescriptor | { type: TSTypeDescriptor; optional?: boolean; readonly?: boolean }> }
  > => {
    const props: Record<string, TSTypeDescriptor | { type: TSTypeDescriptor; optional?: boolean; readonly?: boolean }> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v && typeof v === "object" && "type" in (v as any)) {
        const pv = v as { type: TypeInput; optional?: boolean; readonly?: boolean };
        props[k] = {
          type: toDescriptor(pv.type),
          optional: pv.optional,
          readonly: pv.readonly
        };
      } else {
        props[k] = toDescriptor(v as TypeInput);
      }
    }
    return { kind: "object", properties: props } as any;
  },

  generic: <A extends TypeInput[]>(name: string, ...args: A) => {
    const descriptors = args.map(toDescriptor);
    return {
      kind: "generic" as const,
      name,
      args: descriptors
    } as TypedDescriptor<GenericTypeResult<typeof name & string, typeof descriptors>, { kind: "generic"; name: string; args: TSTypeDescriptor[] }>;
  },

  reference: <T extends TypeInput | undefined = undefined>(
    name: string,
    resolved?: T
  ): TypedDescriptor<
    ExtractType<T>,
    { kind: "reference"; name: string; resolved?: TSTypeDescriptor }
  > => ({ kind: "reference", name, resolved: resolved ? toDescriptor(resolved) : undefined }) as any,

  promise: <T extends TypeInput>(innerType: T): TypedDescriptor<
    Promise<ExtractType<T>>,
    { kind: "generic"; name: "Promise"; args: TSTypeDescriptor[] }
  > => ({ kind: "generic", name: "Promise", args: [toDescriptor(innerType)] }) as any,

  literal: (value: string | number | boolean | null) => ({ kind: "literal" as const, value }),

  tuple: <T extends ReadonlyArray<TypeInput | { type: TypeInput; optional?: boolean }>>(
    ...types: T
  ): TypedDescriptor<
    {
      [K in keyof T]:
        T[K] extends { type: infer U extends TypeInput; optional?: infer O }
          ? O extends true ? ExtractType<U> | undefined : ExtractType<U>
          : T[K] extends TypeInput ? ExtractType<T[K]> : unknown;
    },
    { kind: "tuple"; types: Array<TSTypeDescriptor | { type: TSTypeDescriptor; optional?: boolean }> }
  > => ({
    kind: "tuple",
    types: types.map(t =>
      t && typeof t === "object" && "type" in (t as any)
        ? { type: toDescriptor((t as any).type), optional: (t as any).optional }
        : toDescriptor(t as TypeInput)
    )
  }) as any,

  keyof: <T extends TypeInput>(type: T): TypedDescriptor<
    keyof ExtractType<T>,
    { kind: "keyof"; type: TSTypeDescriptor }
  > => ({ kind: "keyof", type: toDescriptor(type) }) as any,

  typeof: <T>(value: string | VarRef<T>): TypedDescriptor<
    T,
    { kind: "typeof"; name: string; __phantom?: T }
  > => ({
    kind: "typeof",
    name: typeof value === "string" ? value : value.name,
    __phantom: undefined as T
  }) as any,

  typeQuery: <T>(value: string | VarRef<T>): TypedDescriptor<
    T,
    { kind: "typeof"; name: string; __phantom?: T }
  > => ({
    kind: "typeof",
    name: typeof value === "string" ? value : value.name,
    __phantom: undefined as T
  }) as any,

  indexedAccess: <O extends TypeInput, I extends TypeInput>(
    objectType: O,
    indexType: I
  ): TypedDescriptor<
    ExtractType<O>[ExtractType<I> & PropertyKey],
    { kind: "indexed-access"; objectType: TSTypeDescriptor; indexType: TSTypeDescriptor }
  > => ({
    kind: "indexed-access",
    objectType: toDescriptor(objectType),
    indexType: toDescriptor(indexType)
  }) as any,

  conditional: <
    C extends TypeInput,
    E extends TypeInput,
    T extends TypeInput,
    F extends TypeInput
  >(
    checkType: C,
    extendsType: E,
    trueType: T,
    falseType: F
  ): TypedDescriptor<
    ExtractType<T> | ExtractType<F>,
    { kind: "conditional"; checkType: TSTypeDescriptor; extendsType: TSTypeDescriptor; trueType: TSTypeDescriptor; falseType: TSTypeDescriptor }
  > => ({
    kind: "conditional",
    checkType: toDescriptor(checkType),
    extendsType: toDescriptor(extendsType),
    trueType: toDescriptor(trueType),
    falseType: toDescriptor(falseType)
  }) as any,

  mapped: <V extends TypeInput, C extends TypeInput | undefined = undefined>(
    paramName: string,
    valueType: V,
    constraint?: C,
    options?: { readonly?: true | "+" | "-"; optional?: true | "+" | "-"; nameType?: TypeInput; default?: TypeInput }
  ): TypedDescriptor<
    Record<string, ExtractType<V>>,
    {
      kind: "mapped";
      typeParam: { name: string; constraint?: TSTypeDescriptor; default?: TSTypeDescriptor };
      valueType: TSTypeDescriptor;
      readonly?: true | "+" | "-";
      optional?: true | "+" | "-";
      nameType?: TSTypeDescriptor;
    }
  > => ({
    kind: "mapped",
    typeParam: {
      name: paramName,
      constraint: constraint ? toDescriptor(constraint) : undefined,
      default: options?.default ? toDescriptor(options.default) : undefined
    },
    valueType: toDescriptor(valueType),
    readonly: options?.readonly,
    optional: options?.optional,
    nameType: options?.nameType ? toDescriptor(options.nameType) : undefined
  }) as any,

  templateLiteral: (
    head: string,
    spans: Array<{ type: TypeInput; literal: string }>
  ): TypedDescriptor<
    string,
    { kind: "template-literal"; head: string; spans: Array<{ type: TSTypeDescriptor; literal: string }> }
  > => ({
    kind: "template-literal",
    head,
    spans: spans.map(span => ({ type: toDescriptor(span.type), literal: span.literal }))
  }) as any,

  infer: (
    name: string,
    constraint?: TypeInput
  ): TypedDescriptor<
    unknown,
    { kind: "infer"; name: string; constraint?: TSTypeDescriptor }
  > => ({
    kind: "infer",
    name,
    constraint: constraint ? toDescriptor(constraint) : undefined
  }) as any
};

export const typeAliasRegistry = new Map<string, TSTypeDescriptor>();
export const classRegistry = new Map<string, TSTypeDescriptor>();

export function normalizeToExpression(value: unknown): Expression {
  if (typeof value === "string") return brand({ type: "literal", value });
  if (typeof value === "number") return brand({ type: "literal", value });
  if (typeof value === "boolean") return brand({ type: "literal", value });
  if (value === null || value === undefined) return brand({ type: "literal", value: null });

  if (isExpr(value)) {
    return value;
  }

  if (value instanceof VarRef) return brand({ type: "variable", name: value.name });

  if (Array.isArray(value)) {
    return brand({
      type: "array",
      elements: value.map(v => normalizeToExpression(v))
    });
  }

  if (typeof value === "object" && value !== null) {
    const properties: Record<string, Expression> = {};
    for (const [key, val] of Object.entries(value)) {
      properties[key] = normalizeToExpression(val);
    }
    return brand({ type: "object", properties });
  }

  throw new Error(`Cannot normalize value to expression: ${value}`);
}

export type InferenceContext = {
  variables: Map<string, TSTypeDescriptor>;
};

function deduplicateTypes(types: TSTypeDescriptor[]): TSTypeDescriptor[] {
  const seen = new Set<string>();
  return types.filter(t => {
    const key = JSON.stringify(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveDescriptor(descriptor?: TSTypeDescriptor): TSTypeDescriptor {
  if (!descriptor) return types.unknown();
  if ((descriptor as any).resolved) {
    return resolveDescriptor((descriptor as any).resolved as TSTypeDescriptor);
  }
  if (descriptor.kind === "reference") {
    const target = typeAliasRegistry.get(descriptor.name);
    if (target) return resolveDescriptor(target);
  }
  return descriptor;
}

export function inferExpressionType(
  expr: Expression,
  ctx: InferenceContext = { variables: new Map() }
): TSTypeDescriptor {
  switch (expr.type) {
    case "literal":
      if (expr.value === null) return types.null();
      return typeof expr.value === "string" ? types.string()
        : typeof expr.value === "number" ? types.number()
          : types.boolean();

    case "variable":
      return resolveDescriptor(ctx.variables.get(expr.name) ?? types.unknown());

    case "array":
      if (expr.elements.length === 0) return _t.array(types.unknown());
      const elementTypes = expr.elements.map(el => inferExpressionType(el, ctx));
      const uniqueTypes = deduplicateTypes(elementTypes);
      if (uniqueTypes.length === 1) return _t.array(uniqueTypes[0]!);
      return _t.array(_t.union(...uniqueTypes));

    case "object":
      const properties: Record<string, TSTypeDescriptor> = {};
      for (const [key, value] of Object.entries(expr.properties)) {
        properties[key] = inferExpressionType(value, ctx);
      }
      return _t.object(properties);

    case "binary": {
      if (expr.op === "&&" || expr.op === "||") {
        const leftType = inferExpressionType(expr.left, ctx);
        const rightType = inferExpressionType(expr.right, ctx);
        return _t.union(leftType, rightType);
      }

      if (expr.op === "+") {
        const leftType = inferExpressionType(expr.left, ctx);
        const rightType = inferExpressionType(expr.right, ctx);
        const leftString = leftType.kind === "primitive" && leftType.name === "string";
        const rightString = rightType.kind === "primitive" && rightType.name === "string";
        if (leftString || rightString) return types.string();
        const leftNumber = leftType.kind === "primitive" && leftType.name === "number";
        const rightNumber = rightType.kind === "primitive" && rightType.name === "number";
        if (leftNumber && rightNumber) return types.number();
        return types.unknown();
      }

      if (["-", "*", "/", "%", "**"].includes(expr.op)) return types.number();
      if (["===", "!==", ">", "<", ">=", "<=", "==", "!=", "&&", "||"].includes(expr.op)) return types.boolean();
      return types.unknown();
    }

    case "template":
      return types.string();

    case "call":
      const calleeType = inferExpressionType(expr.callee, ctx);
      if (calleeType.kind === "function") return calleeType.returnType;
      return types.unknown();

    case "optional-call": {
      const calleeType = inferExpressionType(expr.callee, ctx);
      if (calleeType.kind === "function") {
        return _t.union(calleeType.returnType, types.undefined());
      }
      return types.undefined();
    }

    case "member":
      const objType = resolveDescriptor(inferExpressionType(expr.object, ctx));
      if (objType.kind === "object" && expr.property in objType.properties) {
        const prop = objType.properties[expr.property]!;
        const base = (prop as any)?.type ? (prop as any).type as TSTypeDescriptor : prop as TSTypeDescriptor;
        const resolved = resolveDescriptor(base);
        return (prop as any)?.optional ? _t.union(resolved, types.undefined()) : resolved;
      }
      if (objType.kind === "array") {
        if (expr.property === "length") return types.number();
        if (/^\d+$/.test(expr.property)) return objType.elementType;
      }
      if (objType.kind === "tuple") {
        const idx = Number(expr.property);
        if (!Number.isNaN(idx) && idx < objType.types.length) {
          const el = objType.types[idx]!;
          const base = (el as any)?.type ? (el as any).type as TSTypeDescriptor : el as TSTypeDescriptor;
          const resolved = resolveDescriptor(base);
          return (el as any)?.optional ? _t.union(resolved, types.undefined()) : resolved;
        }
      }
      return types.unknown();

    case "optional-member": {
      const objType = resolveDescriptor(inferExpressionType(expr.object, ctx));
      if (objType.kind === "object" && expr.property in objType.properties) {
        const prop = objType.properties[expr.property]!;
        const base = (prop as any)?.type ? (prop as any).type as TSTypeDescriptor : prop as TSTypeDescriptor;
        const resolved = resolveDescriptor(base);
        return _t.union((prop as any)?.optional ? _t.union(resolved, types.undefined()) : resolved, types.undefined());
      }
      if (objType.kind === "array") {
        if (expr.property === "length") return _t.union(types.number(), types.undefined());
        if (/^\d+$/.test(expr.property) || expr.computed) return _t.union(objType.elementType, types.undefined());
      }
      if (objType.kind === "tuple") {
        const idx = Number(expr.property);
        if (!Number.isNaN(idx) && idx < objType.types.length) {
          const el = objType.types[idx]!;
          const base = (el as any)?.type ? (el as any).type as TSTypeDescriptor : el as TSTypeDescriptor;
          const resolved = resolveDescriptor(base);
          return _t.union((el as any)?.optional ? _t.union(resolved, types.undefined()) : resolved, types.undefined());
        }
      }
      return _t.union(types.undefined(), types.unknown());
    }

    case "await":
      const argType = inferExpressionType(expr.argument, ctx);
      if (argType.kind === "generic" && argType.name === "Promise" && argType.args[0]) {
        return argType.args[0];
      }
      return argType;

    case "new": {
      if (expr.callee.type === "variable") {
        const ctor = ctx.variables.get(expr.callee.name);
        if (ctor && ctor.kind === "function" && ctor.returnType) return ctor.returnType;
        const registered = classRegistry.get(expr.callee.name);
        if (registered) return registered;
      }
      if (expr.typeArguments && expr.typeArguments.length > 0) {
        return resolveDescriptor(expr.typeArguments[0]!);
      }
      return types.unknown();
    }

    case "unary":
      if (expr.operator === "!") return types.boolean();
      if (expr.operator === "-" || expr.operator === "+") return types.number();
      if (expr.operator === "typeof") return types.string();
      return types.unknown();

    case "conditional":
      const consequentType = inferExpressionType(expr.consequent, ctx);
      const alternateType = inferExpressionType(expr.alternate, ctx);
      const condTypes = deduplicateTypes([consequentType, alternateType]);
      if (condTypes.length === 1) return condTypes[0]!;
      return _t.union(...condTypes);

    case "nullish":
      const leftNullish = inferExpressionType(expr.left, ctx);
      const rightNullish = inferExpressionType(expr.right, ctx);
      return _t.union(nonNullable(leftNullish), rightNullish);

    case "spread":
      const spreadType = inferExpressionType(expr.argument, ctx);
      if (spreadType.kind === "array") return spreadType.elementType;
      return types.unknown();

    case "as":
      return expr.typeAnnotation;

    case "satisfies":
      return inferExpressionType(expr.expression, ctx);

    case "non-null":
      return nonNullable(inferExpressionType(expr.expression, ctx));

    case "this":
      return resolveDescriptor(ctx.variables.get("this") ?? types.unknown());

    case "arrow": {
      const paramTypes = expr.params.map(p => {
        const base = resolveDescriptor(p.tsType ?? types.unknown());
        return p.optional ? _t.union(base, types.undefined()) : base;
      });

      const fnCtx: InferenceContext = { variables: new Map(ctx.variables) };
      expr.params.forEach((p, idx) => {
        fnCtx.variables.set(p.name, paramTypes[idx]!);
      });
      let returnType: TSTypeDescriptor = expr.returnType ? resolveDescriptor(expr.returnType) : types.unknown();

      if (!expr.returnType) {
        if (Array.isArray(expr.body)) {
          const lastReturn = expr.body.find(stmt => stmt.type === "return") as
            | { type: "return"; value?: Expression }
            | undefined;
          if (lastReturn?.value) {
            returnType = inferExpressionType(lastReturn.value, fnCtx);
          }
        } else {
          returnType = inferExpressionType(expr.body, fnCtx);
        }
      }

      return { kind: "function", params: paramTypes, returnType };
    }

    case "update":
      return types.number();

    case "assignment":
      if (expr.operator === "=") {
        return inferExpressionType(expr.right, ctx);
      }
      return inferExpressionType(expr.left, ctx);

    case "tagged-template": {
      const tagType = inferExpressionType(expr.tag, ctx);
      if (tagType.kind === "function") return tagType.returnType;
      return types.unknown();
    }

    case "raw":
    default:
      return types.unknown();
  }
}
