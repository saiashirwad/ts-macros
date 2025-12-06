import type { Expression, TSTypeDescriptor } from "./ir";
import type { VarRef, TypeRef } from "./refs";

// Phantom type symbol for TypedExpression
declare const PhantomType: unique symbol;

// Forward declarations for InferTSType (used inside the type)
type InferParamInternal<P, InferFn> = P extends { type: infer T } ? InferFn : unknown;
type NormalizeParamInternal<P> = P extends TSTypeDescriptor ? { type: P } : P;
type NormalizeParamsInternal<P> = P extends readonly unknown[] ? { [K in keyof P]: NormalizeParamInternal<P[K]> } : [];
type InferParamTupleInternal<P extends readonly unknown[]> =
  P extends readonly [] ? []
  : P extends readonly [infer H, ...infer T]
    ? NormalizeParamInternal<H> extends { type: infer PT }
      ? PT extends TSTypeDescriptor
        ? H extends { rest: true }
          ? InferTSType<PT>[]
          : H extends { optional: true }
            ? [InferTSType<PT> | undefined, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
            : [InferTSType<PT>, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
        : [unknown, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
      : [unknown, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
  : unknown[];

type GenericTypeResult<N extends string, A extends readonly TSTypeDescriptor[]> =
  N extends "Promise" ? (A[0] extends TSTypeDescriptor ? Promise<InferTSType<A[0]>> : Promise<unknown>)
  : any;

// TypedDescriptor carries phantom type through composition
export type TypedDescriptor<T, D extends TSTypeDescriptor = TSTypeDescriptor> = D & {
  readonly __phantom?: T;
};

// Union type for all typed inputs
export type TypeInput = TSTypeDescriptor | TypeRef<unknown> | TypedDescriptor<unknown>;

export type ExtractType<T> =
  T extends TypeRef<infer U> ? U
  : T extends { type: infer V } ?
    V extends TypeRef<infer U> ? U
    : V extends TSTypeDescriptor ? InferTSType<V>
    : ExtractType<V>
  : T extends { __phantom?: infer U } ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

export type InferType<T> =
  T extends { type: "literal"; value: infer V } ? V
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>[]
  : T extends VarRef<infer R> ? R
  : T extends StringExpr ? string
  : T extends NumberExpr ? number
  : T extends BoolExpr ? boolean
  : T extends ArrayExpr<infer Elements> ?
    Elements extends readonly unknown[] ?
      Elements[number] extends infer ElementType ?
        InferType<ElementType>[]
      : never
    : never
  : unknown;

export type InferValueType<V> =
  V extends string ? string
  : V extends number ? number
  : V extends boolean ? boolean
  : V extends VarRef<infer T> ? T
  : V extends TypedExpression<infer T> ? T
  : V extends Expression ? InferType<V>
  : V extends readonly (infer E)[] ? InferValueType<E>[]
  : V extends Record<string, unknown> ? { [K in keyof V]: InferValueType<V[K]> }
  : unknown;

export type InferTSType<T> =
  // Preserve narrow phantom type carried by TypedDescriptor (e.g. types.array/string)
  T extends { __phantom?: infer U } ? U
  : T extends { kind: "primitive"; name: infer N } ?
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
    : unknown[]
  : T extends { kind: "object"; properties: infer P } ?
    P extends Record<string, TSTypeDescriptor> ?
      {
        [K in keyof P]: InferTSType<P[K]>;
      }
    : Record<string, unknown>
  : T extends { kind: "function"; params: infer P; returnType: infer R } ?
    P extends readonly unknown[] ?
      R extends TSTypeDescriptor ?
        (...args: InferParamTupleInternal<NormalizeParamsInternal<P>>) => InferTSType<R>
      : Function
    : Function
  : T extends { kind: "union"; types: infer Types } ?
    Types extends TSTypeDescriptor[] ?
      InferTSType<Types[number]>
    : unknown
  : T extends { kind: "intersection"; types: infer Types } ?
    Types extends TSTypeDescriptor[] ?
      UnionToIntersection<InferTSType<Types[number]>>
    : unknown
  : T extends { kind: "reference"; name: string } ? any
  : T extends { kind: "generic"; name: infer N extends string; args: infer A extends readonly TSTypeDescriptor[] }
    ? GenericTypeResult<N, A>
  : T extends { kind: "literal"; value: infer V } ? V
  : T extends { kind: "tuple"; types: infer Types } ?
    Types extends readonly unknown[] ?
      { [K in keyof Types]:
          Types[K] extends { type: infer TT extends TSTypeDescriptor; optional?: infer O }
            ? (O extends true ? InferTSType<TT> | undefined : InferTSType<TT>)
            : Types[K] extends TSTypeDescriptor ? InferTSType<Types[K]> : unknown }
    : unknown
  : unknown;

export type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;

export type ExtractIterableElementType<T> =
  T extends VarRef<infer U> ? ExtractElementType<U>
  : T extends TypedExpression<infer U> ? ExtractElementType<U>
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>
  : T extends ArrayExpr<infer Elements> ?
    Elements extends readonly unknown[] ?
      Elements[number] extends infer ElementType ?
        InferType<ElementType>
      : never
    : never
  : ExtractElementType<T>;

type ExtractElementType<T> =
  T extends readonly (infer E)[] ? E
  : T extends Set<infer E> ? E
  : T extends Map<infer K, infer V> ? [K, V]
  : T extends string ? string
  : T extends Generator<infer Y, unknown, unknown> ? Y
  : T extends AsyncGenerator<infer Y, unknown, unknown> ? Y
  : T extends Iterable<infer E> ? E
  : T extends AsyncIterable<infer E> ? E
  : unknown;

export type StringExpr = { type: "literal"; value: string };
export type NumberExpr = { type: "literal"; value: number };
export type BoolExpr = { type: "literal"; value: boolean };
export type ArrayExpr<T extends readonly unknown[] = unknown[]> = {
  type: "array";
  elements: T;
};

export type TypedExpression<T> = Expression & { readonly [PhantomType]: T };

export function typedExpr<T>(expr: Expression): TypedExpression<T> {
  return expr as TypedExpression<T>;
}

// === Helper types for extreme inference ===

// Unwrap VarRef/TypedExpression to get inner type
export type UnwrapRef<T> =
  T extends VarRef<infer U> ? U
  : T extends TypedExpression<infer U> ? U
  : T;

// Flexible input accepting VarRef, TypedExpression, or primitives
export type Expr<T> =
  | VarRef<T>
  | TypedExpression<T>
  | (T extends string ? string : T extends number ? number : T extends boolean ? boolean : never);

// For function calls - accept VarRef or literal for each param
export type ToCallArg<T> = T | VarRef<T> | TypedExpression<T>;
export type CallArgs<P extends readonly unknown[]> = { [K in keyof P]: ToCallArg<P[K]> };

// Extract object/function types from nullable refs
export type ExtractObjType<T> =
  T extends VarRef<infer U> ? U
  : T extends TypedExpression<infer U> ? U
  : never;

export type ExtractFnType<T> = ExtractObjType<T>;

// Param schema to object arg (for function return types)
export type ParamSchemaToObjectArg<S extends Record<string, unknown>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

// Simple return type unwrapper (avoids deep recursion unlike InferValueType)
export type UnwrapReturn<R> =
  R extends TypedExpression<infer T> ? T
  : R extends VarRef<infer T> ? T
  : R;

// === Tuple-based param definitions for $.function() ===

export type ParamDef<N extends string = string, T = unknown> = {
  readonly name: N;
  readonly type: T;
  readonly optional?: boolean;
  readonly rest?: boolean;
  readonly default?: unknown;
};

// Simpler extraction to avoid deep recursion (used by ParamDefsToArgs/ParamDefsToTypes)
type SimpleExtract<T> =
  T extends VarRef<infer U> ? U
  : T extends TypeRef<infer U> ? U
  : T extends { __phantom?: infer U } ? U
  : T extends { kind: "primitive"; name: infer N } ?
      N extends "string" ? string : N extends "number" ? number : N extends "boolean" ? boolean : unknown
  : unknown;

// Convert param defs tuple to body args object: { a: VarRef<number>, b: VarRef<string> }
type ParamToArg<P extends ParamDef> = { [K in P["name"]]: VarRef<SimpleExtract<P["type"]>> };
type MergeArgs<A, B> = A & B;

export type ParamDefsToArgs<P extends readonly ParamDef[]> =
  P extends readonly [] ? {}
  : P extends readonly [infer P1 extends ParamDef] ? ParamToArg<P1>
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef]
    ? ParamToArg<P1> & ParamToArg<P2>
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef]
    ? ParamToArg<P1> & ParamToArg<P2> & ParamToArg<P3>
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef, infer P4 extends ParamDef]
    ? ParamToArg<P1> & ParamToArg<P2> & ParamToArg<P3> & ParamToArg<P4>
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef, infer P4 extends ParamDef, infer P5 extends ParamDef]
    ? ParamToArg<P1> & ParamToArg<P2> & ParamToArg<P3> & ParamToArg<P4> & ParamToArg<P5>
  : Record<string, VarRef<unknown>>;

// Convert param defs tuple to positional types: [number, string]
export type ParamDefsToTypes<P extends readonly ParamDef[]> =
  P extends readonly [] ? []
  : P extends readonly [infer P1 extends ParamDef] ? [SimpleExtract<P1["type"]>]
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef]
    ? [SimpleExtract<P1["type"]>, SimpleExtract<P2["type"]>]
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef]
    ? [SimpleExtract<P1["type"]>, SimpleExtract<P2["type"]>, SimpleExtract<P3["type"]>]
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef, infer P4 extends ParamDef]
    ? [SimpleExtract<P1["type"]>, SimpleExtract<P2["type"]>, SimpleExtract<P3["type"]>, SimpleExtract<P4["type"]>]
  : P extends readonly [infer P1 extends ParamDef, infer P2 extends ParamDef, infer P3 extends ParamDef, infer P4 extends ParamDef, infer P5 extends ParamDef]
    ? [SimpleExtract<P1["type"]>, SimpleExtract<P2["type"]>, SimpleExtract<P3["type"]>, SimpleExtract<P4["type"]>, SimpleExtract<P5["type"]>]
  : unknown[];

// === Function arity inference ===
import type { FunctionParam, TSTypeDescriptor as TSTypeDesc } from "./ir";

type InferParam<P> = P extends { type: infer T } ? InferTSType<T> : unknown;

type InferParamTuple<P extends readonly unknown[]> =
  P extends readonly [] ? []
  : P extends readonly [infer H, ...infer T]
    ? H extends { rest: true; type: infer RT }
      ? [...InferTSType<RT>[]]
      : H extends { optional: true }
        ? [InferParam<H>?, ...InferOptionalTail<T>]
        : [InferParam<H>, ...InferParamTuple<T>]
  : unknown[];

type InferOptionalTail<P extends readonly unknown[]> =
  P extends readonly [] ? []
  : P extends readonly [infer H, ...infer T]
    ? [InferParam<H>?, ...InferOptionalTail<T>]
  : [];

// Normalize params - convert TSTypeDescriptor[] to FunctionParam[]
type NormalizeParam<P> = P extends TSTypeDesc ? { type: P } : P;
type NormalizeParams<P> = P extends readonly unknown[] ? { [K in keyof P]: NormalizeParam<P[K]> } : [];

// Export for use in InferTSType
export type { InferParamTuple, NormalizeParams };
