import type { Expression, TSTypeDescriptor } from "./ir";
import { isExpr, brand } from "./ir";
import { VarRef } from "./refs";

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
  array: <T extends TSTypeDescriptor>(elementType: T) => ({ kind: "array" as const, elementType }),
  union: <T extends TSTypeDescriptor[]>(...types: T) => ({ kind: "union" as const, types }),
  intersection: <T extends TSTypeDescriptor[]>(...types: T) => ({ kind: "intersection" as const, types }),
  function: <P extends TSTypeDescriptor[], R extends TSTypeDescriptor>(params: P, returnType: R) => ({ kind: "function" as const, params, returnType }),
  object: <P extends Record<string, TSTypeDescriptor>>(properties: P) => ({ kind: "object" as const, properties }),
  generic: <A extends TSTypeDescriptor[]>(name: string, ...args: A) => ({ kind: "generic" as const, name, args }),
  reference: (name: string) => ({ kind: "reference" as const, name }),
  promise: <T extends TSTypeDescriptor>(innerType: T) => ({ kind: "generic" as const, name: "Promise", args: [innerType] }),
  literal: (value: string | number | boolean) => ({ kind: "literal" as const, value }),
  tuple: <T extends TSTypeDescriptor[]>(...types: T) => ({ kind: "tuple" as const, types })
};

export const typeAliasRegistry = new Map<string, TSTypeDescriptor>();

export function normalizeToExpression(value: any): Expression {
  if (typeof value === "string") return brand({ type: "literal", value });
  if (typeof value === "number") return brand({ type: "literal", value });
  if (typeof value === "boolean") return brand({ type: "literal", value });
  if (value === null || value === undefined) return brand({ type: "literal", value: null as any });

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

export function inferExpressionType(expr: Expression): TSTypeDescriptor {
  switch (expr.type) {
    case "literal":
      return typeof expr.value === "string" ? types.string()
        : typeof expr.value === "number" ? types.number()
        : types.boolean();
    case "array":
      if (expr.elements.length === 0) return types.array(types.any());
      return types.array(inferExpressionType(expr.elements[0]!));
    case "object":
      const properties: Record<string, TSTypeDescriptor> = {};
      for (const [key, value] of Object.entries(expr.properties)) {
        properties[key] = inferExpressionType(value);
      }
      return types.object(properties);
    case "binary":
      if (["+", "-", "*", "/", "%", "**"].includes(expr.op)) return types.number();
      if (["===", "!==", ">", "<", ">=", "<=", "==", "!=", "&&", "||"].includes(expr.op)) return types.boolean();
      if (expr.op === "+") {
        const leftType = inferExpressionType(expr.left);
        if (leftType.kind === "primitive" && leftType.name === "string") return types.string();
      }
      return types.any();
    case "template":
      return types.string();
    case "call":
    case "member":
    case "await":
      return types.any();
    case "unary":
      if (expr.operator === "!") return types.boolean();
      if (expr.operator === "-" || expr.operator === "+") return types.number();
      return types.any();
    case "raw":
      return types.any();
    default:
      return types.any();
  }
}
