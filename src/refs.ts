import * as t from "@babel/types";
import type { Expression, TSTypeDescriptor } from "./ir";
import { brand } from "./ir";
import type { InferTSType, TypedExpression } from "./types";
import { typedExpr } from "./types";

export class TypeRef<T = unknown> {
  declare readonly __tag: "TypeRef";
  declare readonly __type: T;

  constructor(
    public name: string,
    public descriptor: TSTypeDescriptor,
    public resolved?: TSTypeDescriptor
  ) {}

  toDescriptor(): TSTypeDescriptor & { __phantom?: T } {
    const resolved = this.resolved ?? (this.descriptor as any).resolved;
    return {
      ...(this.descriptor as any),
      resolved,
      __phantom: undefined as T
    };
  }

  toBabel(): t.TSTypeReference {
    return t.tsTypeReference(t.identifier(this.name));
  }

  toString(): string {
    return this.name;
  }
}

export class VarRef<T = unknown> {
  declare readonly __tag: "VarRef";
  declare readonly __type: T;

  constructor(
    public name: string,
    public tsType?: TSTypeDescriptor | string
  ) {}

  toBabel(): t.Identifier {
    const id = t.identifier(this.name);
    return id;
  }

  toString(): string {
    return this.name;
  }
}

export class ClassRef<
  Instance = unknown,
  Ctor extends (...args: any[]) => Instance = (...args: any[]) => Instance
> extends VarRef<Ctor> {
  constructor(
    name: string,
    public instanceTsType?: TSTypeDescriptor | string,
    public ctorTsType?: TSTypeDescriptor | string
  ) {
    super(name, ctorTsType);
  }

  new(...args: Parameters<Ctor>): TypedExpression<Instance> {
    const toExpr = (value: unknown): Expression =>
      value instanceof VarRef ? brand({ type: "variable", name: value.name })
      : typeof value === "string" ? brand({ type: "literal", value })
      : typeof value === "number" ? brand({ type: "literal", value })
      : typeof value === "boolean" ? brand({ type: "literal", value })
      : Array.isArray(value) ? brand({
          type: "array",
          elements: value.map(v => toExpr(v)) as Expression[]
        })
      : value && typeof value === "object" ? brand({
          type: "object",
          properties: Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toExpr(v)])
          )
        })
      : value as Expression;

    const argsExpr = (args as unknown[]).map(arg => toExpr(arg));
    const expr: Expression = brand({
      type: "new",
      callee: brand({ type: "variable", name: this.name }),
      arguments: argsExpr,
      typeArguments: undefined
    });
    return typedExpr<Instance>(expr);
  }
}

export function createTypedVarRef<T extends TSTypeDescriptor>(
  name: string,
  typeDesc: T
): VarRef<InferTSType<T>> {
  return new VarRef(name, typeDesc) as VarRef<InferTSType<T>>;
}
