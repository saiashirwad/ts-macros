import * as t from "@babel/types";
import type { TSTypeDescriptor } from "./ir";
import type { InferTSType } from "./types";

export class TypeRef<T = any> {
  declare readonly __tag: "TypeRef";
  declare readonly __type: T;

  constructor(
    public name: string,
    public descriptor: TSTypeDescriptor
  ) {}

  toDescriptor(): TSTypeDescriptor {
    return this.descriptor;
  }

  toBabel(): t.TSTypeReference {
    return t.tsTypeReference(t.identifier(this.name));
  }

  toString(): string {
    return this.name;
  }
}

export class VarRef<T = any> {
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

export function createTypedVarRef<T extends TSTypeDescriptor>(
  name: string,
  typeDesc: T
): VarRef<InferTSType<T>> {
  return new VarRef(name, typeDesc) as VarRef<InferTSType<T>>;
}
