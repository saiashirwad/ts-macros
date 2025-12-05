import type { Expression, TSTypeDescriptor } from "./ir";

// Structural types for VarRef/TypeRef (avoids circular import)
interface VarRefLike<T> {
  readonly __tag: "VarRef";
  readonly __type: T;
}

interface TypeRefLike<T> {
  readonly __tag: "TypeRef";
  readonly __type: T;
}

// Phantom type symbol for TypedExpression
declare const PhantomType: unique symbol;

export type ExtractType<T> =
  T extends TypeRefLike<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : any;

export type InferType<T> =
  T extends { type: "literal"; value: infer V } ? V
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>[]
  : T extends VarRefLike<infer R> ? R
  : T extends StringExpr ? string
  : T extends NumberExpr ? number
  : T extends BoolExpr ? boolean
  : T extends ArrayExpr<infer Elements> ?
    Elements extends readonly any[] ?
      Elements[number] extends infer ElementType ?
        InferType<ElementType>[]
      : never
    : never
  : any;

export type InferValueType<V> =
  V extends string ? string
  : V extends number ? number
  : V extends boolean ? boolean
  : V extends VarRefLike<infer T> ? T
  : V extends TypedExpression<infer T> ? T
  : V extends Expression ? InferType<V>
  : V extends readonly (infer E)[] ? InferValueType<E>[]
  : V extends Record<string, any> ? { [K in keyof V]: InferValueType<V[K]> }
  : any;

export type InferTSType<T> =
  T extends { kind: "primitive"; name: infer N } ?
    N extends "string" ? string
    : N extends "number" ? number
    : N extends "boolean" ? boolean
    : N extends "any" ? any
    : N extends "void" ? void
    : N extends "undefined" ? undefined
    : N extends "null" ? null
    : N extends "never" ? never
    : N extends "unknown" ? unknown
    : never
  : T extends { kind: "array"; elementType: infer E } ?
    E extends TSTypeDescriptor ?
      InferTSType<E>[]
    : any[]
  : T extends { kind: "object"; properties: infer P } ?
    P extends Record<string, TSTypeDescriptor> ?
      {
        [K in keyof P]: InferTSType<P[K]>;
      }
    : Record<string, any>
  : T extends { kind: "function"; params: infer P; returnType: infer R } ?
    P extends TSTypeDescriptor[] ?
      R extends TSTypeDescriptor ?
        (...args: InferTSType<P[number]>[]) => InferTSType<R>
      : Function
    : Function
  : T extends { kind: "union"; types: infer Types } ?
    Types extends TSTypeDescriptor[] ?
      InferTSType<Types[number]>
    : any
  : T extends { kind: "intersection"; types: infer Types } ?
    Types extends TSTypeDescriptor[] ?
      UnionToIntersection<InferTSType<Types[number]>>
    : any
  : T extends { kind: "reference"; name: string } ? any
  : T extends { kind: "generic"; name: string } ? any
  : T extends { kind: "literal"; value: infer V } ? V
  : T extends { kind: "tuple"; types: infer Types } ?
    Types extends TSTypeDescriptor[] ?
      { [K in keyof Types]: InferTSType<Types[K]> }
    : any
  : any;

export type UnionToIntersection<U> = U;

export type ExtractIterableElementType<T> =
  T extends VarRefLike<(infer U)[]> ? U
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>
  : T extends ArrayExpr<infer Elements> ?
    Elements extends readonly any[] ?
      Elements[number] extends infer ElementType ?
        InferType<ElementType>
      : never
    : never
  : any;

export type StringExpr = { type: "literal"; value: string };
export type NumberExpr = { type: "literal"; value: number };
export type BoolExpr = { type: "literal"; value: boolean };
export type ArrayExpr<T extends readonly any[] = any[]> = {
  type: "array";
  elements: T;
};

export type TypedExpression<T> = Expression & { readonly [PhantomType]: T };

export function typedExpr<T>(expr: Expression): TypedExpression<T> {
  return expr as TypedExpression<T>;
}
