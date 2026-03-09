import * as t from "@babel/types";
import type { Expression, TSTypeDescriptor } from "./ir";
import { brand } from "./ir";
import { normalizeToExpression } from "./infer";
import type {
  CallArgs,
  ClassConstructorOf,
  ClassInstanceOf,
  InferTSType,
  TypedExpression,
} from "./types";
import { ClassRefCtorMeta, ClassRefInstanceMeta, typedExpr } from "./types";

export class TypeRef<T = unknown> {
  declare readonly __tag: "TypeRef";
  declare readonly __type: T;

  constructor(
    public name: string,
    public descriptor: TSTypeDescriptor,
    public resolved?: TSTypeDescriptor,
  ) {}

  toDescriptor(): TSTypeDescriptor & { __phantom: T } {
    const resolved = this.resolved ?? (this.descriptor as any).resolved;
    return {
      ...(this.descriptor as any),
      resolved,
      __phantom: undefined as T,
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
    public tsType?: TSTypeDescriptor | string,
  ) {}

  toBabel(): t.Identifier {
    const id = t.identifier(this.name);
    return id;
  }

  toString(): string {
    return this.name;
  }
}

export class ClassMemberRef<T = unknown> extends VarRef<T> {
  declare readonly __classMember: true;

  constructor(
    name: string,
    public memberKey: string,
    tsType?: TSTypeDescriptor | string,
    public options?: {
      kind?: "property" | "method" | "constructor" | "get" | "set";
      static?: boolean;
      accessibility?: "public" | "private" | "protected";
    },
  ) {
    super(name, tsType);
  }
}

export class ClassRef<Host = unknown> extends VarRef<any> {
  declare readonly [ClassRefCtorMeta]: () => Host;
  declare readonly [ClassRefInstanceMeta]: Host;

  constructor(
    name: string,
    public instanceTsType?: TSTypeDescriptor | string,
    public ctorTsType?: TSTypeDescriptor | string,
  ) {
    super(name, ctorTsType);
  }

  new(...args: CallArgs<Parameters<ClassConstructorOf<this>>>): TypedExpression<ClassInstanceOf<this>> {
    const argsExpr = (args as unknown[]).map(arg => normalizeToExpression(arg));
    const expr: Expression = brand({
      type: "new",
      callee: brand({ type: "variable", name: this.name }),
      arguments: argsExpr,
      typeArguments: undefined,
    });
    return typedExpr<ClassInstanceOf<this>>(
      expr,
      typeof this.instanceTsType === "string" ? undefined : this.instanceTsType,
    );
  }
}

export function createTypedVarRef<T extends TSTypeDescriptor>(
  name: string,
  typeDesc: T,
): VarRef<InferTSType<T>> {
  return new VarRef(name, typeDesc) as VarRef<InferTSType<T>>;
}
