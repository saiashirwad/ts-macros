import type { Expression, TSTypeDescriptor } from "./ir";
import { isExpr, brand } from "./ir";
import { VarRef, TypeRef } from "./refs";
import type { TypedDescriptor, TypeInput, ExtractType } from "./types";

function toDescriptor(t: TypeInput): TSTypeDescriptor {
  return t instanceof TypeRef ? t.toDescriptor() : t as TSTypeDescriptor;
}

const _t = {
  array: (elementType: TSTypeDescriptor): TSTypeDescriptor => ({ kind: "array", elementType }),
  union: (...types: TSTypeDescriptor[]): TSTypeDescriptor => ({ kind: "union", types }),
  object: (properties: Record<string, TSTypeDescriptor>): TSTypeDescriptor => ({ kind: "object", properties }),
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

  object: <P extends Record<string, TypeInput>>(properties: P): TypedDescriptor<
    { [K in keyof P]: ExtractType<P[K]> },
    { kind: "object"; properties: Record<string, TSTypeDescriptor> }
  > => {
    const props: Record<string, TSTypeDescriptor> = {};
    for (const [k, v] of Object.entries(properties)) {
      props[k] = toDescriptor(v);
    }
    return { kind: "object", properties: props } as any;
  },

  generic: <A extends TSTypeDescriptor[]>(name: string, ...args: A) => ({ kind: "generic" as const, name, args }),
  reference: (name: string) => ({ kind: "reference" as const, name }),

  promise: <T extends TypeInput>(innerType: T): TypedDescriptor<
    Promise<ExtractType<T>>,
    { kind: "generic"; name: "Promise"; args: TSTypeDescriptor[] }
  > => ({ kind: "generic", name: "Promise", args: [toDescriptor(innerType)] }) as any,

  literal: (value: string | number | boolean) => ({ kind: "literal" as const, value }),

  tuple: <T extends TypeInput[]>(...types: T): TypedDescriptor<
    { [K in keyof T]: ExtractType<T[K]> },
    { kind: "tuple"; types: TSTypeDescriptor[] }
  > => ({ kind: "tuple", types: types.map(toDescriptor) }) as any
};

export const typeAliasRegistry = new Map<string, TSTypeDescriptor>();
export const classRegistry = new Map<string, TSTypeDescriptor>();

export function normalizeToExpression(value: unknown): Expression {
  if (typeof value === "string") return brand({ type: "literal", value });
  if (typeof value === "number") return brand({ type: "literal", value });
  if (typeof value === "boolean") return brand({ type: "literal", value });
  if (value === null || value === undefined) return brand({ type: "literal", value: null as unknown as string | number | boolean });

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

    case "binary":
      if (["+", "-", "*", "/", "%", "**"].includes(expr.op)) return types.number();
      if (["===", "!==", ">", "<", ">=", "<=", "==", "!=", "&&", "||"].includes(expr.op)) return types.boolean();
      if (expr.op === "+") {
        const leftType = inferExpressionType(expr.left, ctx);
        if (leftType.kind === "primitive" && leftType.name === "string") return types.string();
      }
      return types.unknown();

    case "template":
      return types.string();

    case "call":
      const calleeType = inferExpressionType(expr.callee, ctx);
      if (calleeType.kind === "function") return calleeType.returnType;
      return types.unknown();

    case "member":
      const objType = resolveDescriptor(inferExpressionType(expr.object, ctx));
      if (objType.kind === "object" && expr.property in objType.properties) {
        return objType.properties[expr.property]!;
      }
      return types.unknown();

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
      return _t.union(leftNullish, rightNullish);

    case "spread":
      const spreadType = inferExpressionType(expr.argument, ctx);
      if (spreadType.kind === "array") return spreadType.elementType;
      return types.unknown();

    case "raw":
    default:
      return types.unknown();
  }
}
