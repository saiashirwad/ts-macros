import type { Expression, TSTypeDescriptor } from "./ir"
import type { ClassRef, TypeRef, VarRef } from "./refs"

// Phantom type symbol for TypedExpression
declare const PhantomType: unique symbol
export const TypedExprDescriptor = Symbol("TypedExprDescriptor")
export const ClassRefCtorMeta = Symbol("ClassRefCtorMeta")
export const ClassRefInstanceMeta = Symbol("ClassRefInstanceMeta")
export const ClassHostCtorMeta = Symbol("ClassHostCtorMeta")
export const ClassHostInstanceMeta = Symbol("ClassHostInstanceMeta")

// Forward declarations for InferTSType (used inside the type)
type InferParamInternal<P, InferFn> = P extends { type: infer T } ? InferFn : unknown
type NormalizeParamInternal<P> = P extends TSTypeDescriptor ? { type: P } : P
type NormalizeParamsInternal<P> = P extends readonly unknown[]
  ? { [K in keyof P]: NormalizeParamInternal<P[K]> }
  : []
type InferParamTupleInternal<P extends readonly unknown[]> = P extends readonly []
  ? []
  : P extends readonly [infer H, ...infer T]
    ? NormalizeParamInternal<H> extends { type: infer PT }
      ? PT extends TSTypeDescriptor
        ? H extends { rest: true }
          ? InferTSType<PT>[]
          : H extends { optional: true }
            ? [
                InferTSType<PT> | undefined,
                ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>,
              ]
            : [InferTSType<PT>, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
        : [unknown, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
      : [unknown, ...InferParamTupleInternal<T extends readonly unknown[] ? T : []>]
    : unknown[]

type GenericArg<
  A extends readonly TSTypeDescriptor[],
  I extends number,
> = A[I] extends TSTypeDescriptor ? InferTSType<A[I]> : unknown

export type GenericTypeResult<
  N extends string,
  A extends readonly TSTypeDescriptor[],
> = N extends "Promise"
  ? Promise<GenericArg<A, 0>>
  : N extends "Array"
    ? GenericArg<A, 0>[]
    : N extends "ReadonlyArray"
      ? readonly GenericArg<A, 0>[]
      : N extends "Set"
        ? Set<GenericArg<A, 0>>
        : N extends "Map"
          ? Map<GenericArg<A, 0>, GenericArg<A, 1>>
          : N extends "Record"
            ? Record<string, GenericArg<A, 1>>
            : unknown

// TypedDescriptor carries phantom type through composition
export type TypedDescriptor<T, D extends TSTypeDescriptor = TSTypeDescriptor> = D & {
  readonly __phantom: T
}

export type HostClassTypeInput<Instance = unknown> = {
  readonly name: string
  readonly [ClassHostInstanceMeta]: Instance
}

// Union type for all typed inputs
export type TypeInput =
  | TSTypeDescriptor
  | TypeRef<unknown>
  | TypedDescriptor<unknown>
  | ClassRef<any>
  | HostClassTypeInput<any>

export type ExtractType<T> =
  T extends ClassRef<any>
    ? ClassInstanceOf<T>
    : T extends HostClassTypeInput<any>
      ? ClassInstanceOf<T>
      : T extends TypeRef<infer U>
        ? U
        : T extends { type: infer V }
          ? V extends TypeRef<infer U>
            ? U
            : V extends TSTypeDescriptor
              ? InferTSType<V>
              : ExtractType<V>
          : T extends { __phantom: infer U }
            ? U
            : T extends TSTypeDescriptor
              ? InferTSType<T>
              : unknown

export type InferType<T> = T extends { type: "literal"; value: infer V }
  ? V
  : T extends { type: "array"; elements: Array<infer E> }
    ? InferType<E>[]
    : T extends VarRef<infer R>
      ? R
      : T extends StringExpr
        ? string
        : T extends NumberExpr
          ? number
          : T extends BoolExpr
            ? boolean
            : T extends ArrayExpr<infer Elements>
              ? Elements extends readonly unknown[]
                ? Elements[number] extends infer ElementType
                  ? InferType<ElementType>[]
                  : never
                : never
              : unknown

export type InferValueType<V> = V extends string
  ? string
  : V extends number
    ? number
    : V extends boolean
      ? boolean
      : V extends VarRef<infer T>
        ? T
        : V extends TypedExpression<infer T>
          ? T
          : V extends Expression
            ? InferType<V>
            : V extends readonly (infer E)[]
              ? InferValueType<E>[]
              : V extends Record<string, unknown>
                ? { [K in keyof V]: InferValueType<V[K]> }
                : unknown

type ObjectPropertyType<P> = P extends {
  type: infer PT extends TSTypeDescriptor
}
  ? InferTSType<PT>
  : P extends TSTypeDescriptor
    ? InferTSType<P>
    : unknown

type OptionalObjectKeys<P> = {
  [K in keyof P]-?: P[K] extends { optional: true } ? K : never
}[keyof P]

type ReadonlyObjectKeys<P> = {
  [K in keyof P]-?: P[K] extends { readonly: true } ? K : never
}[keyof P]

type RequiredObjectKeys<P> = Exclude<keyof P, OptionalObjectKeys<P>>
type WritableObjectKeys<P> = Exclude<keyof P, ReadonlyObjectKeys<P>>

type Expand<T> = { [K in keyof T]: T[K] }

type InferObjectProperties<P extends Record<string, unknown>> = Expand<
  {
    [K in Exclude<RequiredObjectKeys<P>, ReadonlyObjectKeys<P>>]: ObjectPropertyType<P[K]>
  } & {
    readonly [K in Extract<RequiredObjectKeys<P>, ReadonlyObjectKeys<P>>]: ObjectPropertyType<P[K]>
  } & {
    [K in Exclude<OptionalObjectKeys<P>, ReadonlyObjectKeys<P>>]?: ObjectPropertyType<P[K]>
  } & {
    readonly [K in Extract<OptionalObjectKeys<P>, ReadonlyObjectKeys<P>>]?: ObjectPropertyType<P[K]>
  }
>

export type InferTSType<T> =
  // Preserve narrow phantom type carried by TypedDescriptor (e.g. types.array/string)
  T extends { __phantom: infer U }
    ? U
    : T extends { kind: "primitive"; name: infer N }
      ? N extends "string"
        ? string
        : N extends "number"
          ? number
          : N extends "boolean"
            ? boolean
            : N extends "any"
              ? any
              : N extends "void"
                ? void
                : N extends "undefined"
                  ? undefined
                  : N extends "null"
                    ? null
                    : N extends "never"
                      ? never
                      : N extends "unknown"
                        ? unknown
                        : never
      : T extends { kind: "array"; elementType: infer E }
        ? E extends TSTypeDescriptor
          ? InferTSType<E>[]
          : unknown[]
        : T extends { kind: "object"; properties: infer P }
          ? P extends Record<string, unknown>
            ? InferObjectProperties<P>
            : Record<string, unknown>
          : T extends { kind: "function"; params: infer P; returnType: infer R }
            ? P extends readonly unknown[]
              ? R extends TSTypeDescriptor
                ? (...args: InferParamTupleInternal<NormalizeParamsInternal<P>>) => InferTSType<R>
                : Function
              : Function
            : T extends { kind: "union"; types: infer Types }
              ? Types extends TSTypeDescriptor[]
                ? InferTSType<Types[number]>
                : unknown
              : T extends { kind: "intersection"; types: infer Types }
                ? Types extends TSTypeDescriptor[]
                  ? UnionToIntersection<InferTSType<Types[number]>>
                  : unknown
                : T extends {
                      kind: "reference"
                      resolved: infer R extends TSTypeDescriptor
                    }
                  ? InferTSType<R>
                  : T extends { kind: "reference"; name: string }
                    ? unknown
                    : T extends {
                          kind: "generic"
                          resolved: infer R extends TSTypeDescriptor
                        }
                      ? InferTSType<R>
                      : T extends {
                            kind: "generic"
                            name: infer N extends string
                            args: infer A extends readonly TSTypeDescriptor[]
                          }
                        ? GenericTypeResult<N, A>
                        : T extends { kind: "literal"; value: infer V }
                          ? V
                          : T extends { kind: "tuple"; types: infer Types }
                            ? Types extends readonly unknown[]
                              ? {
                                  [K in keyof Types]: Types[K] extends {
                                    type: infer TT extends TSTypeDescriptor
                                    optional?: infer O
                                  }
                                    ? O extends true
                                      ? InferTSType<TT> | undefined
                                      : InferTSType<TT>
                                    : Types[K] extends TSTypeDescriptor
                                      ? InferTSType<Types[K]>
                                      : unknown
                                }
                              : unknown
                            : T extends {
                                  kind: "mapped"
                                  valueType: infer V extends TSTypeDescriptor
                                }
                              ? Record<string, InferTSType<V>>
                              : T extends {
                                    kind: "conditional"
                                    trueType: infer TTrue extends TSTypeDescriptor
                                    falseType: infer TFalse extends TSTypeDescriptor
                                  }
                                ? InferTSType<TTrue> | InferTSType<TFalse>
                                : T extends {
                                      kind: "indexed-access"
                                      objectType: infer O extends TSTypeDescriptor
                                      indexType: infer I extends TSTypeDescriptor
                                    }
                                  ? O extends {
                                      kind: "object"
                                      properties: infer P extends Record<string, unknown>
                                    }
                                    ? I extends {
                                        kind: "literal"
                                        value: infer L
                                      }
                                      ? L extends keyof P
                                        ? P[L] extends {
                                            type: infer PT extends TSTypeDescriptor
                                            optional?: infer O2
                                          }
                                          ? O2 extends true
                                            ? InferTSType<PT> | undefined
                                            : InferTSType<PT>
                                          : P[L] extends TSTypeDescriptor
                                            ? InferTSType<P[L]>
                                            : unknown
                                        : unknown
                                      : unknown
                                    : unknown
                                  : T extends {
                                        kind: "typeof"
                                        __phantom: infer P
                                      }
                                    ? P
                                    : T extends { kind: "typeof"; name: string }
                                      ? unknown
                                      : T extends {
                                            kind: "keyof"
                                            type: infer KT extends TSTypeDescriptor
                                          }
                                        ? keyof InferTSType<KT>
                                        : T extends { kind: "template-literal" }
                                          ? string
                                          : T extends { kind: "infer" }
                                            ? unknown
                                            : unknown

export type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never

export type ExtractIterableElementType<T> =
  T extends VarRef<infer U>
    ? ExtractElementType<U>
    : T extends TypedExpression<infer U>
      ? ExtractElementType<U>
      : T extends { type: "array"; elements: Array<infer E> }
        ? InferType<E>
        : T extends ArrayExpr<infer Elements>
          ? Elements extends readonly unknown[]
            ? Elements[number] extends infer ElementType
              ? InferType<ElementType>
              : never
            : never
          : ExtractElementType<T>

type ExtractElementType<T> = T extends readonly (infer E)[]
  ? E
  : T extends Set<infer E>
    ? E
    : T extends Map<infer K, infer V>
      ? [K, V]
      : T extends string
        ? string
        : T extends Generator<infer Y, unknown, unknown>
          ? Y
          : T extends AsyncGenerator<infer Y, unknown, unknown>
            ? Y
            : T extends Iterable<infer E>
              ? E
              : T extends AsyncIterable<infer E>
                ? E
                : unknown

export type StringExpr = { type: "literal"; value: string }
export type NumberExpr = { type: "literal"; value: number }
export type BoolExpr = { type: "literal"; value: boolean }
export type ArrayExpr<T extends readonly unknown[] = unknown[]> = {
  type: "array"
  elements: T
}

export type TypedExpression<T> = Expression & {
  readonly [PhantomType]: T
  readonly [TypedExprDescriptor]?: TSTypeDescriptor
}

export function typedExpr<T>(expr: Expression, descriptor?: TSTypeDescriptor): TypedExpression<T> {
  if (descriptor) {
    Object.defineProperty(expr, TypedExprDescriptor, {
      value: descriptor,
      enumerable: false,
      configurable: true,
    })
  }
  return expr as TypedExpression<T>
}

export function getTypedExprDescriptor(expr: unknown): TSTypeDescriptor | undefined {
  return typeof expr === "object" && expr !== null
    ? (expr as { [TypedExprDescriptor]?: TSTypeDescriptor })[TypedExprDescriptor]
    : undefined
}

// === Helper types for extreme inference ===

// Unwrap VarRef/TypedExpression to get inner type
export type UnwrapRef<T> =
  T extends VarRef<infer U> ? U : T extends TypedExpression<infer U> ? U : T

export type AnyClassConstructor = (...args: any[]) => any

export type NormalizeClassCtor<T> = T extends AnyClassConstructor ? T : () => T

export type ClassParams<T> = Parameters<NormalizeClassCtor<T>>

export type ClassInstance<T> = ReturnType<NormalizeClassCtor<T>>

export type ResolvedClassRef<
  Host,
  Ctor extends AnyClassConstructor,
  Instance = ReturnType<Ctor>,
> = ClassRef<Host> & {
  readonly [ClassRefCtorMeta]: Ctor
  readonly [ClassRefInstanceMeta]: Instance
}

export type ClassRefMeta<C extends ClassRef<any>> =
  C extends ClassRef<infer Host>
    ? C extends {
        readonly [ClassRefCtorMeta]: infer Ctor
        readonly [ClassRefInstanceMeta]: infer Instance
      }
      ? Ctor extends AnyClassConstructor
        ? ResolvedClassRef<Host, Ctor, Instance>
        : never
      : Host extends {
            readonly [ClassHostCtorMeta]: infer Ctor
            readonly [ClassHostInstanceMeta]: infer Instance
          }
        ? Ctor extends AnyClassConstructor
          ? ResolvedClassRef<Host, Ctor, Instance>
          : ResolvedClassRef<Host, NormalizeClassCtor<Host>, Instance>
        : Host extends {
              readonly [ClassHostCtorMeta]: infer Ctor
            }
          ? Ctor extends AnyClassConstructor
            ? ResolvedClassRef<Host, Ctor, Host>
            : ResolvedClassRef<Host, NormalizeClassCtor<Host>, Host>
          : Host extends {
                readonly [ClassHostInstanceMeta]: infer Instance
              }
            ? ResolvedClassRef<Host, NormalizeClassCtor<Host>, Instance>
            : ResolvedClassRef<Host, NormalizeClassCtor<Host>, Host>
    : never

export type ResolvedClassHost<
  Host,
  Ctor extends AnyClassConstructor,
  Instance = ReturnType<Ctor>,
> = Host & {
  readonly [ClassHostCtorMeta]: Ctor
  readonly [ClassHostInstanceMeta]: Instance
}

export type ClassConstructorOf<C> = C extends {
  readonly [ClassRefCtorMeta]: infer Ctor
}
  ? Ctor extends AnyClassConstructor
    ? Ctor
    : never
  : C extends {
        readonly [ClassHostCtorMeta]: infer Ctor
      }
    ? Ctor extends AnyClassConstructor
      ? Ctor
      : never
    : C extends ClassRef<infer Host>
      ? Host extends {
          readonly [ClassHostCtorMeta]: infer Ctor
        }
        ? Ctor extends AnyClassConstructor
          ? Ctor
          : NormalizeClassCtor<Host>
        : NormalizeClassCtor<Host>
      : never

export type ClassInstanceOf<C> = C extends {
  readonly [ClassRefInstanceMeta]: infer Instance
}
  ? Instance
  : C extends {
        readonly [ClassHostInstanceMeta]: infer Instance
      }
    ? Instance
    : C extends ClassRef<infer Host>
      ? Host extends {
          readonly [ClassHostInstanceMeta]: infer Instance
        }
        ? Instance
        : Host
      : never

// Flexible input accepting VarRef, TypedExpression, or primitives
export type Expr<T> =
  | VarRef<T>
  | TypedExpression<T>
  | (T extends string ? string : T extends number ? number : T extends boolean ? boolean : never)

// For function calls - accept VarRef or literal for each param
export type ToCallArg<T> = T | VarRef<T> | TypedExpression<T>
export type CallArgs<P extends readonly unknown[]> = {
  [K in keyof P]: ToCallArg<P[K]>
}

// Extract object/function types from nullable refs
export type ExtractObjType<T> =
  T extends VarRef<infer U> ? U : T extends TypedExpression<infer U> ? U : never

export type ExtractFnType<T> = ExtractObjType<T>

// Param schema to object arg (for function return types)
export type ParamSchemaToObjectArg<S extends Record<string, unknown>> = {
  [K in keyof S]: ExtractType<S[K]>
}

type NormalizeReturnValue<T> =
  T extends TypedExpression<infer U>
    ? NormalizeReturnValue<U>
    : T extends VarRef<infer U>
      ? NormalizeReturnValue<U>
      : T extends Expression
        ? NormalizeReturnValue<InferType<T>>
        : T extends (...args: any[]) => any
          ? T
          : T extends Promise<infer U>
            ? Promise<NormalizeReturnValue<U>>
            : T extends readonly unknown[]
              ? { [K in keyof T]: NormalizeReturnValue<T[K]> }
              : T extends object
                ? { [K in keyof T]: NormalizeReturnValue<T[K]> }
                : T

// Function return values should model emitted runtime values, not nested VarRefs.
export type UnwrapReturn<R> = NormalizeReturnValue<R>

// === Tuple-based param definitions for $.function() ===

export type ParamDef<
  N extends string = string,
  T = unknown,
  O extends boolean | undefined = boolean | undefined,
  R extends boolean | undefined = boolean | undefined,
  D = unknown,
> = {
  readonly name: N
  readonly type: T
  readonly optional?: O
  readonly rest?: R
  readonly default?: D
}

// Convert param defs tuple to body args object: { a: VarRef<number>, b: VarRef<string> }
type ParamToArg<P extends ParamDef> = {
  [K in P["name"]]: VarRef<ExtractType<P["type"]>>
}

type ParamDefType<P extends ParamDef> = ExtractType<P["type"]>
type ParamDefHasOptional<P extends ParamDef> = true extends P["optional"] ? true : false
type ParamDefHasRest<P extends ParamDef> = true extends P["rest"] ? true : false
type ParamDefHasDefault<P extends ParamDef> =
  Exclude<P["default"], undefined> extends never ? false : true

type ParamDefsHasRequired<P extends readonly ParamDef[]> = P extends readonly [
  infer Head extends ParamDef,
  ...infer Tail extends readonly ParamDef[],
]
  ? ParamDefHasRest<Head> extends true
    ? false
    : ParamDefHasOptional<Head> extends true
      ? ParamDefsHasRequired<Tail>
      : ParamDefHasDefault<Head> extends true
        ? ParamDefsHasRequired<Tail>
        : true
  : false

type ParamDefsToOptionalTail<P extends readonly ParamDef[]> = P extends readonly []
  ? []
  : P extends readonly [infer Head extends ParamDef, ...infer Tail extends readonly ParamDef[]]
    ? ParamDefHasRest<Head> extends true
      ? [...ParamDefType<Head>[]]
      : [ParamDefType<Head>?, ...ParamDefsToOptionalTail<Tail>]
    : []

export type ParamDefsToArgs<P extends readonly ParamDef[]> = P extends readonly [
  infer Head extends ParamDef,
  ...infer Tail extends readonly ParamDef[],
]
  ? ParamToArg<Head> & ParamDefsToArgs<Tail>
  : {}

// Convert param defs tuple to positional types: [number, string]
export type ParamDefsToTypes<P extends readonly ParamDef[]> = P extends readonly [
  infer Head extends ParamDef,
  ...infer Tail extends readonly ParamDef[],
]
  ? ParamDefHasRest<Head> extends true
    ? [...ParamDefType<Head>[]]
    : ParamDefHasOptional<Head> extends true
      ? ParamDefsHasRequired<Tail> extends true
        ? [ParamDefType<Head> | undefined, ...ParamDefsToTypes<Tail>]
        : [ParamDefType<Head>?, ...ParamDefsToOptionalTail<Tail>]
      : ParamDefHasDefault<Head> extends true
        ? ParamDefsHasRequired<Tail> extends true
          ? [ParamDefType<Head> | undefined, ...ParamDefsToTypes<Tail>]
          : [ParamDefType<Head>?, ...ParamDefsToOptionalTail<Tail>]
        : [ParamDefType<Head>, ...ParamDefsToTypes<Tail>]
  : []

// === Function arity inference ===
import type { TSTypeDescriptor as TSTypeDesc } from "./ir"

type InferParam<P> = P extends { type: infer T } ? InferTSType<T> : unknown

type InferParamTuple<P extends readonly unknown[]> = P extends readonly []
  ? []
  : P extends readonly [infer H, ...infer T]
    ? H extends { rest: true; type: infer RT }
      ? [...InferTSType<RT>[]]
      : H extends { optional: true }
        ? [InferParam<H>?, ...InferOptionalTail<T>]
        : [InferParam<H>, ...InferParamTuple<T>]
    : unknown[]

type InferOptionalTail<P extends readonly unknown[]> = P extends readonly []
  ? []
  : P extends readonly [infer H, ...infer T]
    ? [InferParam<H>?, ...InferOptionalTail<T>]
    : []

// Normalize params - convert TSTypeDescriptor[] to FunctionParam[]
type NormalizeParam<P> = P extends TSTypeDesc ? { type: P } : P
type NormalizeParams<P> = P extends readonly unknown[]
  ? { [K in keyof P]: NormalizeParam<P[K]> }
  : []

// Export for use in InferTSType
export type { InferParamTuple, NormalizeParams }
