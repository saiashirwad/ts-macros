import * as t from "@babel/types";
import { parseTypeString, statementToBabel, typeDescriptorToTSType } from "./babel";
import {
  createBuildContext,
  getActiveBuildContext,
  registerClass,
  registerTypeAlias,
  withBuildContext,
} from "./context";
import {
  inferExpressionType,
  inferStatementsReturnType,
  normalizeToExpression,
  resolveDescriptor,
  types,
  widenForDeclaration,
} from "./infer";
import type {
  ClassMember,
  EnumMember,
  Expression,
  Param,
  Statement,
  TSTypeDescriptor,
  TemplateExpression,
  TypeParameter,
} from "./ir";
import { brand } from "./ir";
import { ClassMemberRef, ClassRef, TypeRef, VarRef } from "./refs";
import type {
  BoolExpr,
  CallArgs,
  ClassConstructorOf,
  ClassInstanceOf,
  ClassInstance,
  ExtractIterableElementType,
  ExtractObjType,
  ExtractType,
  InferTSType,
  InferValueType,
  HostClassTypeInput,
  NormalizeClassCtor,
  NumberExpr,
  ParamDef,
  ParamDefsToArgs,
  ParamDefsToTypes,
  StringExpr,
  TypeInput,
  TypedExpression,
  ResolvedClassRef,
  UnwrapRef,
  UnwrapReturn,
} from "./types";
import {
  ClassHostCtorMeta,
  ClassHostInstanceMeta,
  getTypedExprDescriptor,
  typedExpr,
} from "./types";

type DescriptorInput =
  | TSTypeDescriptor
  | TypeRef<unknown>
  | ClassRef<any>
  | HostClassTypeInput<any>
  | string
  | undefined;

const isUnknownish = (type?: TSTypeDescriptor): boolean => {
  if (!type) return true;
  if (type.kind === "primitive") return type.name === "unknown";
  if (type.kind === "array") return isUnknownish(type.elementType);
  if (type.kind === "object")
    return Object.values(type.properties).every(prop => {
      const desc =
        (prop as any)?.type ? ((prop as any).type as TSTypeDescriptor) : (prop as TSTypeDescriptor);
      return isUnknownish(desc);
    });
  if (type.kind === "union" || type.kind === "intersection") return type.types.every(isUnknownish);
  if (type.kind === "tuple")
    return type.types.every(el => {
      const desc =
        (el as any)?.type ? ((el as any).type as TSTypeDescriptor) : (el as TSTypeDescriptor);
      return isUnknownish(desc);
    });
  return false;
};

const normalizeParam = (p: {
  name: string;
  tsType?: TSTypeDescriptor | TypeRef<unknown>;
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
}): Param => {
  if (p.rest && (p.optional || p.default !== undefined)) {
    throw new Error("Rest parameters cannot be optional or have a default value");
  }
  if (p.optional && p.default !== undefined) {
    throw new Error("Optional parameters cannot have default values");
  }

  const tsType = p.tsType instanceof TypeRef ? p.tsType.toDescriptor() : p.tsType;

  const normalizedType: TSTypeDescriptor | undefined =
    p.rest ?
      tsType && (tsType.kind === "array" || tsType.kind === "tuple") ?
        tsType
      : { kind: "array", elementType: tsType ?? types.unknown() }
    : tsType;

  const defaultValue = p.default === undefined ? undefined : normalizeToExpression(p.default);

  return {
    name: p.name,
    tsType: normalizedType,
    optional: p.optional,
    rest: p.rest,
    default: defaultValue,
  };
};

const toExpr = (value: unknown): Expression => normalizeToExpression(value);

const toExprList = (values: readonly unknown[]): Expression[] =>
  values.map(value => normalizeToExpression(value));

const toTypeDesc = (type: DescriptorInput): TSTypeDescriptor | undefined => {
  if (type === undefined) return undefined;
  if (type instanceof TypeRef) return type.toDescriptor();
  if (type instanceof ClassRef) {
    return {
      kind: "reference",
      name: type.name,
      resolved: typeof type.instanceTsType === "string" ? undefined : type.instanceTsType,
    };
  }
  if (typeof type === "function" && isMacroClass(type)) {
    return {
      kind: "reference",
      name: getMacroDefinition(type).name,
    };
  }
  if (typeof type === "string") return parseTypeString(type);
  return type as TSTypeDescriptor;
};

const createExpressionInferenceContext = (
  values: readonly unknown[],
): {
  variables: Map<string, TSTypeDescriptor>;
  buildContext: ReturnType<typeof getActiveBuildContext>;
} => {
  const variables = new Map<string, TSTypeDescriptor>();
  const thisProperties: Record<string, TSTypeDescriptor> = {};

  for (const value of values) {
    if (!(value instanceof VarRef)) continue;
    const descriptor = toTypeDesc(value.tsType as DescriptorInput) ?? types.unknown();
    variables.set(value.name, descriptor);

    if (value instanceof ClassMemberRef) {
      thisProperties[value.memberKey] = descriptor;
    }
  }

  if (Object.keys(thisProperties).length > 0) {
    variables.set("this", {
      kind: "object",
      properties: thisProperties,
    });
  }

  return {
    variables,
    buildContext: getActiveBuildContext(),
  };
};

const explicitExprType = (
  expr: Expression,
  ...values: readonly unknown[]
): TSTypeDescriptor | undefined => {
  const explicit = getTypedExprDescriptor(expr);
  if (explicit) return explicit;
  const inferred = inferExpressionType(expr, createExpressionInferenceContext(values));
  return isUnknownish(inferred) ? undefined : inferred;
};

const inferDeclarationTsType = (
  expr: Expression,
  ...values: readonly unknown[]
): TSTypeDescriptor =>
  widenForDeclaration(explicitExprType(expr, ...values) ?? inferExpressionType(expr));

const inferIterableElementDescriptor = (
  descriptor?: TSTypeDescriptor,
): TSTypeDescriptor | undefined => {
  if (!descriptor) return undefined;

  const buildContext = getActiveBuildContext();
  const resolved = resolveDescriptor(descriptor, buildContext);

  if (resolved.kind === "array") {
    return resolveDescriptor(resolved.elementType, buildContext);
  }

  if (resolved.kind === "tuple") {
    if (resolved.types.length === 0) return { kind: "primitive", name: "unknown" };
    const elementTypes = resolved.types.map(element =>
      resolveDescriptor(
        ((element as { type?: TSTypeDescriptor }).type ?? element) as TSTypeDescriptor,
        buildContext,
      ),
    );
    return elementTypes.length === 1 ? elementTypes[0] : { kind: "union", types: elementTypes };
  }

  if (resolved.kind === "generic") {
    if (
      (resolved.name === "Array" || resolved.name === "ReadonlyArray" || resolved.name === "Set") &&
      resolved.args[0]
    ) {
      return resolveDescriptor(resolved.args[0], buildContext);
    }
    if (resolved.name === "Map" && resolved.args[0] && resolved.args[1]) {
      return {
        kind: "tuple",
        types: [
          resolveDescriptor(resolved.args[0], buildContext),
          resolveDescriptor(resolved.args[1], buildContext),
        ],
      };
    }
  }

  if (resolved.kind === "primitive" && resolved.name === "string") {
    return types.string();
  }

  return undefined;
};

type PropValue<T, K extends PropertyKey> =
  T extends VarRef<unknown> | TypedExpression<unknown> ?
    K extends keyof UnwrapRef<T> ?
      UnwrapRef<T>[K]
    : unknown
  : T extends Expression ? unknown
  : never;

type AnnotationToType<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

type MethodReturn<ROpt, R> =
  ROpt extends TypeRef<infer U> ? U
  : ROpt extends TSTypeDescriptor ? InferTSType<ROpt>
  : UnwrapReturn<R>;

type ClassMethodKind = "method" | "constructor" | "get" | "set";

type ClassMethodRefType<
  Kind extends ClassMethodKind,
  Params extends readonly ParamDef[],
  ReturnAnnot,
  R,
> =
  Kind extends "get" ? MethodReturn<ReturnAnnot, R>
  : Params extends readonly [] ? () => MethodReturn<ReturnAnnot, R>
  : (...args: ParamDefsToTypes<Params>) => MethodReturn<ReturnAnnot, R>;

type InstanceShape<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

const FinalizeClassMember = Symbol("FinalizeClassMember");

type DeferredClassMember = ClassMember & {
  ref?: VarRef<unknown>;
  [FinalizeClassMember]?: (thisDesc?: TSTypeDescriptor) => void;
};

type ClassPropertyValue<TAnnot, V> =
  [TAnnot] extends [undefined] ? InferValueType<V> : AnnotationToType<Exclude<TAnnot, undefined>>;

type ClassPropertyOptions<
  V,
  TAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
> = {
  value?: V;
  typeAnnotation?: TAnnot;
  static?: boolean;
  readonly?: boolean;
  accessibility?: "public" | "private" | "protected";
};

type YieldedClassMember<
  TRef extends ClassMemberRef<any>,
  TMeta extends ClassYieldMeta = ClassYieldMeta,
> = TMeta & { ref: TRef };

type ClassPropertyMember<T> = YieldableClassMember<
  ClassMemberRef<T>,
  { type: "property"; key: string }
>;

type ClassMethodMember<
  Kind extends ClassMethodKind,
  Params extends readonly ParamDef[],
  ReturnAnnot,
  R,
> = YieldableClassMember<
  ClassMemberRef<ClassMethodRefType<Kind, Params, ReturnAnnot, R>>,
  { type: "method"; key: string; kind: Kind }
>;

type ConstructorRef<Params extends readonly ParamDef[]> = ClassMemberRef<
  (...args: ParamDefsToTypes<Params>) => void
> & {
  readonly __constructorRef: true;
};

type YieldableClassMember<
  TRef extends ClassMemberRef<any>,
  TMeta extends ClassYieldMeta = ClassYieldMeta,
> = Generator<YieldedClassMember<TRef, TMeta>, TRef, VarRef<unknown>>;

type ConstructorMember<Params extends readonly ParamDef[]> = YieldableClassMember<
  ConstructorRef<Params>,
  { type: "method"; key: "constructor"; kind: "constructor" }
>;

type MethodArgsFor<TObj, TMethod extends keyof TObj> =
  Extract<TObj[TMethod], (...args: any[]) => unknown> extends (...args: infer A) => unknown ? A
  : never[];

type MethodReturnFor<TObj, TMethod extends keyof TObj> =
  Extract<TObj[TMethod], (...args: any[]) => unknown> extends (...args: any[]) => infer R ? R
  : never;

type ZeroArgMethodReturnFor<TObj, TMethod extends keyof TObj> =
  Extract<TObj[TMethod], () => unknown> extends () => infer R ? R : never;

type ImplementsInput =
  | TSTypeDescriptor
  | TypeRef<unknown>
  | readonly (TSTypeDescriptor | TypeRef<unknown>)[];
type InferImplements<I> = I extends readonly (infer E)[] ? InstanceShape<E> : InstanceShape<I>;

type ClassYieldMeta = {
  type: "property" | "method";
  key: string;
  kind?: ClassMethodKind;
  ref?: VarRef<unknown>;
};

type ClassBodyFactory<
  TYield extends ClassYieldMeta = ClassYieldMeta,
  TReturn = void,
> = () => Generator<TYield, TReturn, VarRef<unknown>>;

type AnyClassBodyFactory = (...args: any[]) => Generator<any, any, any>;

type BodyYield<BodyFactory> =
  BodyFactory extends (...args: any[]) => Generator<infer Y, any, any> ? Y : never;

type BodyReturn<BodyFactory> =
  BodyFactory extends (...args: any[]) => Generator<any, infer R, any> ? R : void;

type PublicShapeFromBodyReturn<Ret> =
  Ret extends Record<string, VarRef<any>> ?
    { [K in keyof Ret]: Ret[K] extends VarRef<infer T> ? T : unknown }
  : never;

type ClassInstanceOutFromBody<BodyFactory, InstanceAnnot, Implements> =
  PublicShapeFromBodyReturn<BodyReturn<BodyFactory>> extends never ?
    ClassInstanceType<InstanceAnnot, Implements>
  : PublicShapeFromBodyReturn<BodyReturn<BodyFactory>>;

type ExtractConstructorRefType<Y> =
  Extract<
    Y,
    {
      kind: "constructor";
      ref: ClassMemberRef<any>;
    }
  > extends infer M ?
    M extends { ref: ClassMemberRef<infer Fn> } ?
      Fn
    : never
  : never;

type ClassConstructorParamsOutFromBody<BodyFactory> =
  [ExtractConstructorRefType<BodyYield<BodyFactory>>] extends [never] ? []
  : ExtractConstructorRefType<BodyYield<BodyFactory>> extends (...args: infer Args) => any ? Args
  : [];

type ClassConstructorOutFromBody<BodyFactory, Instance> =
  (...args: ClassConstructorParamsOutFromBody<BodyFactory>) => Instance;

type MissingSelfGeneric<
  Usage extends string,
  Params extends string = "",
> = `Missing \`Self\` generic - use \`class Self extends ${Usage}<Self>()(${Params}{ ... })\``;

type MissingHostClassSelfGeneric =
  'Missing `Self` generic - use `class Self extends $.class<Self>("Name")(function* () { ... }) {}`';

const MacroClassDefinition = Symbol("MacroClassDefinition");

type MacroClassDefinitionShape<
  Body extends AnyClassBodyFactory = AnyClassBodyFactory,
  Self = unknown,
> = {
  name: string;
  body: Body;
  typeParams?: TypeParameter[];
  readonly __self?: Self;
};

type AnyMacroClass = {
  new (...args: any[]): any;
  readonly [MacroClassDefinition]: MacroClassDefinitionShape<any, any>;
  readonly [Symbol.iterator]: () => Generator<Statement, ClassRef<any>, any>;
};

type ClassParamInput =
  | TSTypeDescriptor
  | TypeRef<any>
  | {
      type: TSTypeDescriptor | TypeRef<any>;
      optional?: boolean;
      rest?: boolean;
      default?: unknown;
    };

type ArrowParamInput = {
  name: string;
  tsType?: TSTypeDescriptor | TypeRef<unknown>;
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
};

type ParamOptions = {
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
};

type ParamOptionValue<Options, Key extends keyof ParamOptions> =
  Options extends undefined ? undefined
  : Key extends keyof Options ? Options[Key]
  : undefined;

type ArrowHasOptional<P extends ArrowParamInput> = P extends { optional: true } ? true : false;
type ArrowHasRest<P extends ArrowParamInput> = P extends { rest: true } ? true : false;
type ArrowHasDefault<P extends ArrowParamInput> =
  P extends { default: infer D } ?
    Exclude<D, undefined> extends never ?
      false
    : true
  : false;

type ArrowParamToType<P> =
  P extends { tsType?: infer T } ?
    T extends TypeRef<infer U> ? U
    : T extends TSTypeDescriptor ? InferTSType<T>
    : unknown
  : unknown;

type ArrowParamHasRequired<Ps extends readonly ArrowParamInput[]> =
  Ps extends readonly [infer H, ...infer T] ?
    H extends ArrowParamInput ?
      ArrowHasRest<H> extends true ? false
      : ArrowHasOptional<H> extends true ?
        ArrowParamHasRequired<T extends readonly ArrowParamInput[] ? T : []>
      : ArrowHasDefault<H> extends true ?
        ArrowParamHasRequired<T extends readonly ArrowParamInput[] ? T : []>
      : true
    : false
  : false;

type ArrowParamsToOptionalTail<Ps extends readonly ArrowParamInput[]> =
  Ps extends readonly [] ? []
  : Ps extends readonly [infer H, ...infer T] ?
    H extends ArrowParamInput ?
      ArrowHasRest<H> extends true ?
        [...Array<ArrowParamToType<H>>]
      : [
          ArrowParamToType<H>?,
          ...ArrowParamsToOptionalTail<T extends readonly ArrowParamInput[] ? T : []>,
        ]
    : []
  : [];

type ArrowParamsToTuple<Ps extends readonly ArrowParamInput[]> =
  Ps extends readonly [] ? []
  : Ps extends readonly [infer H, ...infer T] ?
    H extends ArrowParamInput ?
      ArrowHasRest<H> extends true ? [...Array<ArrowParamToType<H>>]
      : ArrowHasOptional<H> extends true ?
        ArrowParamHasRequired<T extends readonly ArrowParamInput[] ? T : []> extends true ?
          [
            ArrowParamToType<H> | undefined,
            ...ArrowParamsToTuple<T extends readonly ArrowParamInput[] ? T : []>,
          ]
        : [
            ArrowParamToType<H>?,
            ...ArrowParamsToOptionalTail<T extends readonly ArrowParamInput[] ? T : []>,
          ]
      : ArrowHasDefault<H> extends true ?
        ArrowParamHasRequired<T extends readonly ArrowParamInput[] ? T : []> extends true ?
          [
            ArrowParamToType<H> | undefined,
            ...ArrowParamsToTuple<T extends readonly ArrowParamInput[] ? T : []>,
          ]
        : [
            ArrowParamToType<H>?,
            ...ArrowParamsToOptionalTail<T extends readonly ArrowParamInput[] ? T : []>,
          ]
      : [ArrowParamToType<H>, ...ArrowParamsToTuple<T extends readonly ArrowParamInput[] ? T : []>]
    : []
  : [];

const normalizeClassParamInput = (
  value: ClassParamInput,
): {
  type: TSTypeDescriptor | TypeRef<any>;
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
} => {
  if (value && typeof value === "object" && "type" in (value as any)) {
    const v = value as {
      type: TSTypeDescriptor | TypeRef<any>;
      optional?: boolean;
      rest?: boolean;
      default?: unknown;
    };
    return {
      type: v.type,
      optional: v.optional,
      rest: v.rest,
      default: v.default,
    };
  }
  return { type: value as TSTypeDescriptor | TypeRef<any> };
};

const normalizeFunctionParams = (params: readonly ParamDef[]): Param[] =>
  params.map(p =>
    normalizeParam({
      name: p.name,
      tsType: toTypeDesc(p.type as DescriptorInput),
      optional: p.optional,
      rest: p.rest,
      default: p.default,
    }),
  );

const normalizeClassMethodParams = (params: Record<string, ClassParamInput>): Param[] =>
  Object.entries(params).map(([name, value]) => {
    const paramSource = normalizeClassParamInput(value);
    return normalizeParam({
      name,
      tsType: toTypeDesc(paramSource.type),
      optional: paramSource.optional,
      rest: paramSource.rest,
      default: paramSource.default,
    });
  });

const createParamBindings = (
  paramArray: readonly Param[],
): {
  ctx: {
    variables: Map<string, TSTypeDescriptor>;
    buildContext: ReturnType<typeof getActiveBuildContext>;
  };
  argsByName: Record<string, VarRef<unknown>>;
} => {
  const ctx = {
    variables: new Map<string, TSTypeDescriptor>(),
    buildContext: getActiveBuildContext(),
  };
  const argsByName: Record<string, VarRef<unknown>> = {};

  for (const param of paramArray) {
    const descriptor = param.tsType ?? types.unknown();
    argsByName[param.name] = new VarRef(param.name, descriptor);
    ctx.variables.set(param.name, descriptor);
  }

  return { ctx, argsByName };
};

const collectFunctionLikeBody = <R>(
  generator: Generator<Statement, R, any>,
  ctx: {
    variables: Map<string, TSTypeDescriptor>;
    buildContext: ReturnType<typeof getActiveBuildContext>;
  },
): {
  bodyStatements: Statement[];
  inferredReturnType?: TSTypeDescriptor;
} => {
  const bodyStatements: Statement[] = [];
  let result = generator.next();

  while (!result.done) {
    const stmt = result.value as Statement;
    if (stmt.type === "const" || stmt.type === "let") {
      const inferred = inferExpressionType(stmt.value, ctx);
      const shouldReplace = !stmt.tsType || isUnknownish(stmt.tsType);
      if (shouldReplace) stmt.tsType = widenForDeclaration(inferred);
      ctx.variables.set(stmt.name, resolveDescriptor(stmt.tsType, ctx.buildContext));
    }
    bodyStatements.push(stmt);
    result = generator.next();
  }

  if (result.value !== undefined) {
    bodyStatements.push({
      type: "return",
      value: toExpr(result.value),
    });
  }

  return {
    bodyStatements,
    inferredReturnType: inferStatementsReturnType(bodyStatements, ctx),
  };
};

const finalizeReturnType = (
  provided?: TSTypeDescriptor,
  inferred?: TSTypeDescriptor,
): TSTypeDescriptor | undefined =>
  provided && !isUnknownish(provided) ? provided : (inferred ?? provided);

const buildFunctionTsType = (
  paramArray: readonly Param[],
  returnType?: TSTypeDescriptor,
): TSTypeDescriptor => ({
  kind: "function",
  params: paramArray.map(param => param.tsType ?? types.unknown()),
  returnType: returnType ?? types.unknown(),
});

const createClassPropertyMember = ((
  key: string,
  options?:
    | TSTypeDescriptor
    | TypeRef<unknown>
    | ClassPropertyOptions<unknown, TSTypeDescriptor | TypeRef<unknown> | undefined>,
): ClassPropertyMember<unknown> =>
  (function* () {
    const normalized =
      (
        options &&
        typeof options === "object" &&
        ("value" in options ||
          "typeAnnotation" in options ||
          "static" in options ||
          "readonly" in options ||
          "accessibility" in options)
      ) ?
        (options as ClassPropertyOptions<unknown, TSTypeDescriptor | TypeRef<unknown> | undefined>)
      : {
          typeAnnotation: options as TSTypeDescriptor | TypeRef<unknown> | undefined,
        };

    const valueExpr =
      normalized && "value" in normalized ? normalizeToExpression(normalized.value) : undefined;
    const desc =
      toTypeDesc(normalized?.typeAnnotation) ??
      (valueExpr ?
        (explicitExprType(valueExpr, normalized.value) ?? inferExpressionType(valueExpr))
      : undefined);
    const ref = new ClassMemberRef<unknown>(key, key, desc, {
      kind: "property",
      static: normalized?.static,
      accessibility: normalized?.accessibility,
    });

    const member: YieldedClassMember<ClassMemberRef<unknown>, { type: "property"; key: string }> &
      ClassMember = {
      type: "property",
      key,
      value: valueExpr,
      typeAnnotation: toTypeDesc(normalized?.typeAnnotation),
      static: normalized?.static,
      readonly: normalized?.readonly,
      accessibility: normalized?.accessibility,
      ref,
    };

    const injected = yield member;
    return (injected as ClassMemberRef<unknown> | undefined) ?? ref;
  })()) as {
  (key: string): ClassPropertyMember<unknown>;
  <V>(
    key: string,
    options: ClassPropertyOptions<V, undefined>,
  ): ClassPropertyMember<InferValueType<V>>;
  <TAnnot extends TSTypeDescriptor | TypeRef<unknown>>(
    key: string,
    options: TAnnot | ClassPropertyOptions<unknown, TAnnot>,
  ): ClassPropertyMember<AnnotationToType<TAnnot>>;
};

type ClassMethodOptions<
  Kind extends ClassMethodKind,
  ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined,
  ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined,
> = {
  kind?: Kind;
  returnType?: ReturnAnnot;
  thisType?: ThisAnnot;
  static?: boolean;
  async?: boolean;
  accessibility?: "public" | "private" | "protected";
};

type CreateClassMethod = {
  <
    const Params extends readonly ParamDef[],
    R = void,
    ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
  >(
    key: string,
    params: [...Params],
    body: (
      args: ParamDefsToArgs<Params>,
      this_: VarRef<AnnotationToType<ThisAnnot>>,
    ) => Generator<Statement, R, unknown>,
    options?: ClassMethodOptions<"method", ReturnAnnot, ThisAnnot>,
  ): ClassMethodMember<"method", Params, ReturnAnnot, R>;
  <
    const Params extends readonly ParamDef[],
    R = void,
    ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
  >(
    key: string,
    params: [...Params],
    body: (
      args: ParamDefsToArgs<Params>,
      this_: VarRef<AnnotationToType<ThisAnnot>>,
    ) => Generator<Statement, R, unknown>,
    options: ClassMethodOptions<"get", ReturnAnnot, ThisAnnot> & {
      kind: "get";
    },
  ): ClassMethodMember<"get", Params, ReturnAnnot, R>;
  <
    const Params extends readonly ParamDef[],
    R = void,
    ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
  >(
    key: string,
    params: [...Params],
    body: (
      args: ParamDefsToArgs<Params>,
      this_: VarRef<AnnotationToType<ThisAnnot>>,
    ) => Generator<Statement, R, unknown>,
    options: ClassMethodOptions<"set", ReturnAnnot, ThisAnnot> & {
      kind: "set";
    },
  ): ClassMethodMember<"set", Params, ReturnAnnot, R>;
  <
    const Params extends readonly ParamDef[],
    R = void,
    ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
  >(
    key: string,
    params: [...Params],
    body: (
      args: ParamDefsToArgs<Params>,
      this_: VarRef<AnnotationToType<ThisAnnot>>,
    ) => Generator<Statement, R, unknown>,
    options: ClassMethodOptions<"constructor", ReturnAnnot, ThisAnnot> & {
      kind: "constructor";
    },
  ): ClassMethodMember<"constructor", Params, ReturnAnnot, R>;
};

const createClassMethodImpl = function* (
  key: string,
  params: readonly ParamDef[],
  body: (
    args: Record<string, VarRef<unknown>>,
    this_: VarRef<unknown>,
  ) => Generator<Statement, unknown, unknown>,
  options?: ClassMethodOptions<
    ClassMethodKind,
    TSTypeDescriptor | TypeRef<unknown> | undefined,
    TSTypeDescriptor | TypeRef<unknown> | undefined
  >,
): Generator<
  YieldedClassMember<ClassMemberRef<any>, { type: "method"; key: string; kind: ClassMethodKind }>,
  ClassMemberRef<any>,
  VarRef<unknown>
> {
  const paramArray = normalizeFunctionParams(params);
  const providedReturnType = toTypeDesc(options?.returnType);
  const explicitThisDesc = toTypeDesc(options?.thisType);

  const ref = new ClassMemberRef<any>(
    key,
    key,
    options?.kind === "get" ?
      providedReturnType
    : buildFunctionTsType(paramArray, providedReturnType),
    {
      kind: options?.kind ?? "method",
      static: options?.static,
      accessibility: options?.accessibility,
    },
  );

  const member: YieldedClassMember<
    ClassMemberRef<any>,
    { type: "method"; key: string; kind: ClassMethodKind }
  > &
    ClassMember & {
      [FinalizeClassMember]: (thisDesc?: TSTypeDescriptor) => void;
    } = {
    type: "method",
    key,
    kind: (options?.kind ?? "method") as ClassMethodKind,
    params: paramArray,
    body: [],
    returnType: providedReturnType,
    static: options?.static,
    async: options?.async,
    accessibility: options?.accessibility,
    ref,
    [FinalizeClassMember]: (thisDesc?: TSTypeDescriptor) => {
      const { ctx, argsByName } = createParamBindings(paramArray);
      const args = argsByName as Record<string, VarRef<unknown>>;
      const effectiveThisDesc = explicitThisDesc ?? thisDesc;
      const this_ = new VarRef("this", effectiveThisDesc);
      if (effectiveThisDesc) {
        ctx.variables.set("this", effectiveThisDesc);
      }

      const { bodyStatements, inferredReturnType } = collectFunctionLikeBody(
        body(args, this_),
        ctx,
      );
      const finalReturnType = finalizeReturnType(providedReturnType, inferredReturnType);
      (
        member as ClassMember & {
          type: "method";
          body: Statement[];
          returnType?: TSTypeDescriptor;
        }
      ).body = bodyStatements;
      (
        member as ClassMember & {
          type: "method";
          body: Statement[];
          returnType?: TSTypeDescriptor;
        }
      ).returnType = finalReturnType;
      ref.tsType =
        options?.kind === "get" ?
          finalReturnType
        : buildFunctionTsType(paramArray, finalReturnType);
    },
  };
  const injected = yield member;
  return (injected as ClassMemberRef<any> | undefined) ?? ref;
};

const createClassMethod = createClassMethodImpl as unknown as CreateClassMethod;

const normalizeMacroParams = (params: readonly TSTypeDescriptor[]): Param[] =>
  params.map((tsType, index) => normalizeParam({ name: `arg${index}`, tsType }));

const createTupleMethodImpl = function* (
  key: string,
  params: readonly TSTypeDescriptor[],
  body: (...args: VarRef<unknown>[]) => Generator<Statement, unknown, unknown>,
  options?: ClassMethodOptions<
    ClassMethodKind,
    TSTypeDescriptor | TypeRef<unknown> | undefined,
    TSTypeDescriptor | TypeRef<unknown> | undefined
  >,
): Generator<
  YieldedClassMember<ClassMemberRef<any>, { type: "method"; key: string; kind: ClassMethodKind }>,
  ClassMemberRef<any>,
  VarRef<unknown>
> {
  const paramArray = normalizeMacroParams(params);
  const providedReturnType = toTypeDesc(options?.returnType);
  const explicitThisDesc = toTypeDesc(options?.thisType);

  const ref = new ClassMemberRef<any>(
    key,
    key,
    options?.kind === "get" ?
      providedReturnType
    : buildFunctionTsType(paramArray, providedReturnType),
    {
      kind: options?.kind ?? "method",
      static: options?.static,
      accessibility: options?.accessibility,
    },
  );

  const member: YieldedClassMember<
    ClassMemberRef<any>,
    { type: "method"; key: string; kind: ClassMethodKind }
  > &
    ClassMember & {
      [FinalizeClassMember]: (thisDesc?: TSTypeDescriptor) => void;
    } = {
    type: "method",
    key,
    kind: (options?.kind ?? "method") as ClassMethodKind,
    params: paramArray,
    body: [],
    returnType: providedReturnType,
    static: options?.static,
    async: options?.async,
    accessibility: options?.accessibility,
    ref,
    [FinalizeClassMember]: (thisDesc?: TSTypeDescriptor) => {
      const { ctx, argsByName } = createParamBindings(paramArray);
      const tupleArgs = paramArray.map(param => argsByName[param.name]) as VarRef<unknown>[];
      const effectiveThisDesc = explicitThisDesc ?? thisDesc;
      const this_ = new VarRef("this", effectiveThisDesc);
      if (effectiveThisDesc) {
        ctx.variables.set("this", effectiveThisDesc);
      }

      const { bodyStatements, inferredReturnType } = collectFunctionLikeBody(
        body(...tupleArgs),
        ctx,
      );
      const finalReturnType = finalizeReturnType(providedReturnType, inferredReturnType);
      (
        member as ClassMember & {
          type: "method";
          body: Statement[];
          returnType?: TSTypeDescriptor;
        }
      ).body = bodyStatements;
      (
        member as ClassMember & {
          type: "method";
          body: Statement[];
          returnType?: TSTypeDescriptor;
        }
      ).returnType = finalReturnType;
      ref.tsType =
        options?.kind === "get" ?
          finalReturnType
        : buildFunctionTsType(paramArray, finalReturnType);
    },
  };
  const injected = yield member;
  return (injected as ClassMemberRef<any> | undefined) ?? ref;
};

const createTupleConstructorImpl = function* (
  params: readonly TSTypeDescriptor[],
  body: (...args: VarRef<unknown>[]) => Generator<Statement, unknown, unknown>,
): Generator<
  YieldedClassMember<
    ClassMemberRef<any>,
    { type: "method"; key: "constructor"; kind: "constructor" }
  >,
  ClassMemberRef<any>,
  VarRef<unknown>
> {
  const paramArray = normalizeMacroParams(params);
  const ref = new ClassMemberRef<any>(
    "constructor",
    "constructor",
    buildFunctionTsType(paramArray),
    {
      kind: "constructor",
    },
  );

  const member: YieldedClassMember<
    ClassMemberRef<any>,
    { type: "method"; key: "constructor"; kind: "constructor" }
  > &
    ClassMember & {
      [FinalizeClassMember]: () => void;
    } = {
    type: "method",
    key: "constructor",
    kind: "constructor",
    params: paramArray,
    body: [],
    ref,
    [FinalizeClassMember]: () => {
      const { ctx, argsByName } = createParamBindings(paramArray);
      const tupleArgs = paramArray.map(param => argsByName[param.name]) as VarRef<unknown>[];
      const { bodyStatements } = collectFunctionLikeBody(body(...tupleArgs), ctx);
      (member as ClassMember & { body: Statement[] }).body = bodyStatements;
      ref.tsType = buildFunctionTsType(paramArray);
    },
  };

  const injected = yield member;
  return (injected as ClassMemberRef<any> | undefined) ?? ref;
};

const isMacroClass = (value: unknown): value is AnyMacroClass =>
  typeof value === "function" && MacroClassDefinition in value;

const getMacroDefinition = (value: AnyMacroClass): MacroClassDefinitionShape<any, any> =>
  value[MacroClassDefinition];

type ClassInstanceType<InstanceAnnot, Implements> =
  InstanceAnnot extends TSTypeDescriptor | TypeRef<unknown> ? InstanceShape<InstanceAnnot>
  : Implements extends ImplementsInput ? InferImplements<Implements>
  : unknown;

type NumberLike = number | VarRef<number> | TypedExpression<number>;
type BooleanLike = boolean | VarRef<boolean> | TypedExpression<boolean>;
type ComparableInput<T> = VarRef<T> | TypedExpression<T> | T;

type EnumNamesFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> =
  Members[number] extends infer M ?
    M extends { id: infer I } ? I
    : M extends string ? M
    : never
  : never;

type EnumValueFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> =
  Members[number] extends infer M ?
    M extends { initializer: infer I } ?
      I extends string | number | boolean ?
        I
      : number
    : number
  : number;

type EnumShapeFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> =
  {
    [K in EnumNamesFrom<Members> & string]: EnumValueFrom<Members>;
  };

type BindingConfig<V = unknown> = {
  value: V;
  tsType?: TSTypeDescriptor | TypeRef<unknown>;
  kind?: "let" | "const";
};

type BindingInput = unknown | BindingConfig;

type BindingValue<T> =
  T extends Expression ? T
  : T extends BindingConfig<infer V> ? V
  : T;

type ValueOrAnnotationType<V, TAnnot> =
  [TAnnot] extends [undefined] ? InferValueType<V> : AnnotationToType<Exclude<TAnnot, undefined>>;

type BindingResultType<T> =
  T extends { tsType?: infer TAnnot } ? ValueOrAnnotationType<BindingValue<T>, TAnnot>
  : InferValueType<BindingValue<T>>;

type MacroHostShapeFromBody<Body> =
  PublicShapeFromBodyReturn<BodyReturn<Body>> extends never ? {}
  : PublicShapeFromBodyReturn<BodyReturn<Body>>;

type MacroClassType<
  Body extends AnyClassBodyFactory = AnyClassBodyFactory,
  Self = unknown,
> = (abstract new (...args: any[]) => MacroHostShapeFromBody<Body>) & {
  readonly [MacroClassDefinition]: MacroClassDefinitionShape<Body, Self>;
  readonly [ClassHostCtorMeta]: ClassConstructorOutFromBody<Body, Self>;
  readonly [ClassHostInstanceMeta]: Self;
  readonly [Symbol.iterator]: () => Generator<Statement, ClassRef<Self>, any>;
};

type MacroClassResolvedRefType<C> =
  C extends {
    readonly [MacroClassDefinition]: MacroClassDefinitionShape<any, infer Self>;
  } ?
    ClassRef<Self>
  : never;

type MacroClassInstanceType<C> =
  C extends {
    readonly [MacroClassDefinition]: MacroClassDefinitionShape<any, infer Self>;
  } ?
    Self
  : never;

type CreateClass = {
  <Self = never>(
    name: string,
  ): <const Body extends AnyClassBodyFactory>(
    body: Body,
    options?: {
      typeParams?: TypeParameter[];
    },
  ) => [Self] extends [never] ? MissingHostClassSelfGeneric : MacroClassType<Body, Self>;
  <C extends AnyMacroClass>(
    macroClass: C,
  ): Generator<Statement, MacroClassResolvedRefType<C>, any>;
  <
    Implements extends ImplementsInput | undefined = undefined,
    InstanceAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
  >(
    name: string,
    options?: {
      extends?: unknown;
      implements?: Implements;
      instanceType?: InstanceAnnot;
      typeParams?: TypeParameter[];
      body?: never;
    },
  ): Generator<
    Statement,
    ResolvedClassRef<
      ClassInstanceType<InstanceAnnot, Implements>,
      () => ClassInstanceType<InstanceAnnot, Implements>,
      ClassInstanceType<InstanceAnnot, Implements>
    >,
    any
  >;
  <BodyFactory extends AnyClassBodyFactory>(
    name: string,
    body: BodyFactory,
  ): Generator<
    Statement,
    ResolvedClassRef<
      ClassInstanceOutFromBody<BodyFactory, undefined, undefined>,
      ClassConstructorOutFromBody<
        BodyFactory,
        ClassInstanceOutFromBody<BodyFactory, undefined, undefined>
      >,
      ClassInstanceOutFromBody<BodyFactory, undefined, undefined>
    >,
    any
  >;
  (
    name: string,
    options: {
      extends?: unknown;
      implements?: ImplementsInput;
      instanceType?: TSTypeDescriptor | TypeRef<unknown>;
      typeParams?: TypeParameter[];
    },
    body: AnyClassBodyFactory,
  ): Generator<Statement, ResolvedClassRef<any, (...args: any[]) => any, any>, any>;
};

type MacroClassFactory = <Self = never>(
  name: string,
) => <const Body extends AnyClassBodyFactory>(
  body: Body,
  options?: {
    typeParams?: TypeParameter[];
  },
) => [Self] extends [never] ? MissingHostClassSelfGeneric : MacroClassType<Body, Self>;

const createMacroClassHost = ((name: string) =>
  (
    body: AnyClassBodyFactory,
    options?: {
      typeParams?: TypeParameter[];
    },
  ) => {
    const definition = {
      name,
      body,
      typeParams: options?.typeParams,
    };

    abstract class MacroBase {
      static readonly [MacroClassDefinition] = definition;

      static [Symbol.iterator](this: AnyMacroClass): Generator<Statement, ClassRef<any>, any> {
        return createClassImpl(this) as Generator<
          Statement,
          ClassRef<any>,
          any
        >;
      }
    }

    return MacroBase;
  }) as MacroClassFactory;

export const MacroClass = createMacroClassHost;

const createClassImpl = function* (
  name: string | AnyMacroClass,
  optionsOrBody?:
    | {
        extends?: unknown;
        implements?: ImplementsInput;
        instanceType?: TSTypeDescriptor | TypeRef<unknown>;
        typeParams?: TypeParameter[];
      }
    | AnyClassBodyFactory,
  bodyArg?: AnyClassBodyFactory,
): Generator<Statement, ResolvedClassRef<any, (...args: any[]) => any, any>, any> {
  if (isMacroClass(name)) {
    const macroClass = name;
    const definition = getMacroDefinition(macroClass);
    const runMacroGenerator = (
      iterator: Generator<ClassMember, unknown, VarRef<unknown>>,
      members: ClassMember[],
    ) => {
      let step = iterator.next();

      while (!step.done) {
        const member = step.value as ClassMember;
        members.push(member);
        const ref = (member as DeferredClassMember).ref;
        if (ref instanceof VarRef) {
          step = iterator.next(ref);
        } else {
          step = iterator.next();
        }
      }

      return step.value;
    };

    const members: ClassMember[] = [];
    const publicReturn = runMacroGenerator(definition.body(), members) as
      | Record<string, VarRef<any>>
      | undefined;

    const exportedKeys = new Set<string>();
    if (publicReturn) {
      for (const [key, value] of Object.entries(publicReturn)) {
        if (!(value instanceof ClassMemberRef)) {
          throw new Error(
            `Macro class ${definition.name} body() must return class member refs; ${key} was not a class member`,
          );
        }
        if (value.memberKey !== key) {
          throw new Error(
            `Macro class ${definition.name} body() cannot alias ${value.memberKey} as ${key}`,
          );
        }
        exportedKeys.add(key);
      }
    }

    for (const member of members) {
      if (member.static || (member.type === "method" && member.kind === "constructor")) {
        continue;
      }

      member.accessibility = exportedKeys.has(member.key) ? undefined : "private";
    }

    return yield* createClassImpl(
      definition.name,
      {
        typeParams: definition.typeParams,
      },
      function* () {
        for (const member of members) {
          yield member;
        }
        return publicReturn;
      },
    );
  }

  const className = name as string;

  const collectedProps: Record<string, TSTypeDescriptor> = {};
  const collectedMethods: Record<string, TSTypeDescriptor> = {};
  let synthesizedThis: TSTypeDescriptor | undefined;
  const resetCollectedMembers = () => {
    for (const key of Object.keys(collectedProps)) {
      delete collectedProps[key];
    }
    for (const key of Object.keys(collectedMethods)) {
      delete collectedMethods[key];
    }
    synthesizedThis = undefined;
  };
  const bodyMembers: ClassMember[] = [];
  const rememberMember = (member: ClassMember): TSTypeDescriptor | undefined => {
    if (member.type === "property") {
      const descriptor =
        member.typeAnnotation ??
        (member.value ?
          inferExpressionType(member.value, {
            variables: new Map<string, TSTypeDescriptor>(),
            buildContext: getActiveBuildContext(),
          })
        : undefined);
      if (descriptor) {
        collectedProps[member.key] = descriptor;
        synthesizedThis = synthesizedThis ?? { kind: "object", properties: {} };
        if (synthesizedThis.kind === "object") {
          synthesizedThis.properties[member.key] = descriptor;
        }
      }
      return descriptor;
    }

    if (member.kind === "constructor") {
      return undefined;
    }

    if (member.kind === "get") {
      const descriptor = member.returnType ?? types.unknown();
      collectedProps[member.key] = descriptor;
      synthesizedThis = synthesizedThis ?? { kind: "object", properties: {} };
      if (synthesizedThis.kind === "object") {
        synthesizedThis.properties[member.key] = descriptor;
      }
      return descriptor;
    }

    if (member.kind === "set") {
      const descriptor = member.params[0]?.tsType ?? types.unknown();
      collectedProps[member.key] = descriptor;
      synthesizedThis = synthesizedThis ?? { kind: "object", properties: {} };
      if (synthesizedThis.kind === "object") {
        synthesizedThis.properties[member.key] = descriptor;
      }
      return descriptor;
    }

    const paramTypes = member.params.map(p => p.tsType ?? types.unknown());
    const returnType = member.returnType ?? types.unknown();
    const fnDesc: TSTypeDescriptor = {
      kind: "function",
      params: paramTypes,
      returnType,
    };
    collectedMethods[member.key] = fnDesc;
    synthesizedThis = synthesizedThis ?? { kind: "object", properties: {} };
    if (synthesizedThis.kind === "object") {
      synthesizedThis.properties[member.key] = fnDesc;
    }
    return fnDesc;
  };
  const rebuildSynthesizedThis = () => {
    resetCollectedMembers();
    for (const member of bodyMembers) {
      rememberMember(member);
    }
  };

  const bodyFactory = typeof optionsOrBody === "function" ? optionsOrBody : bodyArg;
  const optionsObj = typeof optionsOrBody === "function" ? {} : (optionsOrBody ?? {});

  if (
    optionsObj &&
    typeof optionsObj === "object" &&
    "body" in (optionsObj as Record<string, unknown>)
  ) {
    throw new Error("Use $.class(name, options, function* () { ... }) instead of options.body");
  }
  let publicReturn: Record<string, VarRef<any>> | undefined;

  if (bodyFactory) {
    const iterator = bodyFactory();
    if (!iterator || typeof iterator.next !== "function") {
      throw new Error("Class body must be a generator function yielding class members");
    }
    let step = iterator.next();
    while (!step.done) {
      const member = step.value as ClassMember;
      bodyMembers.push(member);

      let injected: VarRef<unknown> | undefined;
      const memberRef = (member as DeferredClassMember).ref;
      if (memberRef instanceof VarRef) {
        injected = memberRef;
      }

      step = injected ? iterator.next(injected) : iterator.next();
    }
    publicReturn = step.value as Record<string, VarRef<any>> | undefined;
  }

  rebuildSynthesizedThis();
  const classThisType = toTypeDesc(optionsObj.instanceType) ?? synthesizedThis;
  for (const member of bodyMembers) {
    (member as DeferredClassMember)[FinalizeClassMember]?.(classThisType);
  }
  rebuildSynthesizedThis();

  const stmt: Statement = {
    type: "class",
    id: className,
    superClass:
      optionsObj.extends ?
        typeof optionsObj.extends === "string" ?
          brand({ type: "variable", name: optionsObj.extends })
        : toExpr(optionsObj.extends)
      : undefined,
    implements: (() => {
      const impls = optionsObj.implements;
      if (!impls) return undefined;
      const list = Array.isArray(impls) ? impls : [impls];
      return list.map(v => toTypeDesc(v) ?? types.unknown());
    })(),
    typeParameters: optionsObj.typeParams,
    body: bodyMembers,
  };

  yield stmt;

  const publicDescriptor: TSTypeDescriptor | undefined =
    publicReturn ?
      {
        kind: "object",
        properties: Object.fromEntries(
          Object.entries(publicReturn).map(([k, v]) => {
            const tsType = (v as VarRef<any>).tsType;
            const desc = toTypeDesc(tsType as DescriptorInput) ?? types.unknown();
            return [k, desc];
          }),
        ),
      }
    : undefined;

  const inferredInstanceShape = publicDescriptor ?? synthesizedThis;
  const instanceTsType: TSTypeDescriptor | undefined =
    optionsObj.instanceType ? toTypeDesc(optionsObj.instanceType)
    : inferredInstanceShape ?
      { kind: "reference", name: className, resolved: inferredInstanceShape }
    : { kind: "reference", name: className };

  if (instanceTsType) {
    registerClass(className, instanceTsType);
  }

  const constructorMember = bodyMembers.find(
    (
      member,
    ): member is ClassMember & {
      type: "method";
      kind: "constructor";
      params: Param[];
    } => member.type === "method" && member.kind === "constructor",
  );
  const ctorTsType =
    constructorMember ?
      buildFunctionTsType(constructorMember.params, instanceTsType)
    : buildFunctionTsType([], instanceTsType);

  return new ClassRef(className, instanceTsType, ctorTsType) as ResolvedClassRef<
    any,
    (...args: any[]) => any,
    any
  >;
};

const createClass = ((
  nameOrMacroClass: string | AnyMacroClass,
  optionsOrBody?: unknown,
  bodyArg?: AnyClassBodyFactory,
) => {
  if (
    typeof nameOrMacroClass === "string" &&
    optionsOrBody === undefined &&
    bodyArg === undefined
  ) {
    return createMacroClassHost(nameOrMacroClass);
  }

  return createClassImpl(
    nameOrMacroClass as string | AnyMacroClass,
    optionsOrBody as any,
    bodyArg,
  );
}) as CreateClass;

export const $ = {
  string: (value: string): StringExpr => brand({ type: "literal", value }),
  number: (value: number): NumberExpr => brand({ type: "literal", value }),
  bool: (value: boolean): BoolExpr => brand({ type: "literal", value }),

  array: <const T extends readonly any[]>(
    elements: T,
  ): TypedExpression<InferValueType<T[number]>[]> => {
    const expr: Expression = brand({
      type: "array",
      elements: toExprList(elements) as Expression[],
    });
    return typedExpr<InferValueType<T[number]>[]>(
      expr,
      inferExpressionType(expr, createExpressionInferenceContext(elements)),
    );
  },

  *let<const V, TAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined>(
    name: string,
    value: V,
    tsType?: TAnnot,
  ): Generator<Statement, VarRef<ValueOrAnnotationType<V, TAnnot>>, any> {
    const expr = toExpr(value);
    const descriptor: TSTypeDescriptor =
      toTypeDesc(tsType as DescriptorInput) ?? inferDeclarationTsType(expr, value);
    const stmt: Statement = {
      type: "let",
      name,
      value: expr,
      tsType: descriptor,
    };
    yield stmt;
    return new VarRef<ValueOrAnnotationType<V, TAnnot>>(name, descriptor);
  },

  *const<const V, TAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined>(
    name: string,
    value: V,
    tsType?: TAnnot,
  ): Generator<Statement, VarRef<ValueOrAnnotationType<V, TAnnot>>, any> {
    const expr = toExpr(value);
    const descriptor: TSTypeDescriptor =
      toTypeDesc(tsType as DescriptorInput) ?? inferDeclarationTsType(expr, value);
    const stmt: Statement = {
      type: "const",
      name,
      value: expr,
      tsType: descriptor,
    };
    yield stmt;
    return new VarRef<ValueOrAnnotationType<V, TAnnot>>(name, descriptor);
  },

  bind: (() => {
    const core = function* <const T extends Record<string, BindingInput>>(
      bindings: T,
      defaultKind: "let" | "const" = "const",
    ): Generator<Statement, { [K in keyof T]: VarRef<BindingResultType<T[K]>> }, any> {
      const result: Record<string, VarRef<unknown>> = {};

      for (const [key, raw] of Object.entries(bindings)) {
        const normalized =
          raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ?
            (raw as {
              value: unknown;
              tsType?: TSTypeDescriptor | TypeRef<unknown>;
              kind?: "let" | "const";
            })
          : ({ value: raw } as {
              value: unknown;
              tsType?: TSTypeDescriptor | TypeRef<unknown>;
              kind?: "let" | "const";
            });

        const kind = normalized.kind ?? defaultKind;
        const expr = toExpr(normalized.value);
        const descriptor =
          normalized.tsType instanceof TypeRef ?
            normalized.tsType.toDescriptor()
          : (normalized.tsType ?? inferDeclarationTsType(expr, normalized.value));

        const stmt: Statement = {
          type: kind,
          name: key,
          value: expr,
          tsType: descriptor,
        };

        yield stmt;
        result[key] = new VarRef(key, descriptor);
      }

      return result as { [K in keyof T]: VarRef<BindingResultType<T[K]>> };
    };

    const bindConst = function* <const T extends Record<string, BindingInput>>(bindings: T) {
      return yield* core(bindings, "const");
    };

    const bindLet = function* <const T extends Record<string, BindingInput>>(bindings: T) {
      return yield* core(bindings, "let");
    };

    return Object.assign(core, { const: bindConst, let: bindLet });
  })(),

  object: <T extends Record<string, unknown>>(
    obj: T,
  ): TypedExpression<{
    [K in keyof T]: InferValueType<T[K]>;
  }> => {
    const properties: Record<string, Expression> = {};
    for (const [key, value] of Object.entries(obj)) {
      properties[key] = toExpr(value);
    }
    const expr: Expression = brand({ type: "object", properties });
    return typedExpr<{ [K in keyof T]: InferValueType<T[K]> }>(
      expr,
      inferExpressionType(expr, createExpressionInferenceContext(Object.values(obj))),
    );
  },

  prop: (() => {
    type PropOverload = {
      <TObj, K extends keyof TObj>(
        obj: VarRef<TObj>,
        key: K & string,
      ): TypedExpression<TObj[K]>;
      <TObj, K extends keyof TObj>(
        obj: TypedExpression<TObj>,
        key: K & string,
      ): TypedExpression<TObj[K]>;
      <TObj, K extends keyof TObj>(
        obj: VarRef<TObj> | TypedExpression<TObj>,
        key: K & string,
      ): TypedExpression<TObj[K]>;
      <T extends Expression, K extends string>(obj: T, key: K): TypedExpression<unknown>;
      <T extends VarRef<unknown> | TypedExpression<unknown> | Expression, TValue>(
        obj: T,
        key: ClassMemberRef<TValue>,
      ): TypedExpression<TValue>;
    };

    const propImpl = (
      obj: VarRef<unknown> | TypedExpression<unknown> | Expression,
      key: string | ClassMemberRef<unknown>,
    ): TypedExpression<unknown> => {
      const property = key instanceof ClassMemberRef ? key.memberKey : String(key);
      const expr: Expression = brand({
        type: "member",
        object: toExpr(obj),
        property,
      });
      return typedExpr<unknown>(expr, explicitExprType(expr, obj));
    };

    return propImpl as PropOverload;
  })(),

  methodCall: (() => {
    type MethodCallOverload = {
      <TObj, TMethod extends keyof TObj>(
        obj: VarRef<TObj> | TypedExpression<TObj>,
        method: TMethod,
      ): TypedExpression<ZeroArgMethodReturnFor<TObj, TMethod>>;
      <Args extends readonly unknown[], R>(
        obj: VarRef<unknown> | TypedExpression<unknown>,
        method: ClassMemberRef<(...args: Args) => R>,
      ): TypedExpression<R>;
      <TObj, TMethod extends keyof TObj>(
        obj: VarRef<TObj> | TypedExpression<TObj>,
        method: TMethod,
        args: CallArgs<MethodArgsFor<TObj, TMethod>>,
      ): TypedExpression<MethodReturnFor<TObj, TMethod>>;
      <Args extends readonly unknown[], R>(
        obj: VarRef<unknown> | TypedExpression<unknown>,
        method: ClassMemberRef<(...args: Args) => R>,
        args: CallArgs<Args>,
      ): TypedExpression<R>;
    };

    const methodCallImpl = (
      obj: VarRef<any> | TypedExpression<any>,
      method: PropertyKey | ClassMemberRef<any>,
      args: unknown[] = [],
    ): TypedExpression<unknown> => {
      const property = method instanceof ClassMemberRef ? method.memberKey : String(method);
      const expr: Expression = brand({
        type: "call",
        callee: brand({
          type: "member",
          object: toExpr(obj),
          property,
        }),
        args: toExprList(args),
      });
      return typedExpr<unknown>(expr, explicitExprType(expr, obj));
    };

    return methodCallImpl as MethodCallOverload;
  })(),

  template: (
    parts: TemplateStringsArray | string[],
    ...expressions: unknown[]
  ): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "template",
      parts: Array.from(parts),
      expressions: expressions.map(expr => normalizeToExpression(expr)),
    });
    return typedExpr<string>(expr, types.string());
  },

  await: <T>(promise: VarRef<Promise<T>> | TypedExpression<Promise<T>>): TypedExpression<T> => {
    const expr: Expression = brand({
      type: "await",
      argument: toExpr(promise),
    });
    return typedExpr<T>(expr, explicitExprType(expr, promise));
  },

  not: (operand: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "!",
      operand: toExpr(operand),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  typeof: (operand: unknown): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "typeof",
      operand: toExpr(operand),
    });
    return typedExpr<string>(expr, types.string());
  },

  ternary: <C, A>(
    test: unknown,
    consequent: C,
    alternate: A,
  ): TypedExpression<InferValueType<C> | InferValueType<A>> => {
    const expr: Expression = brand({
      type: "conditional",
      test: toExpr(test),
      consequent: toExpr(consequent),
      alternate: toExpr(alternate),
    });
    return typedExpr<InferValueType<C> | InferValueType<A>>(
      expr,
      explicitExprType(expr, test, consequent, alternate),
    );
  },

  spread: <T extends readonly unknown[]>(
    argument: VarRef<T> | TypedExpression<T> | T,
  ): TypedExpression<T[number]> => {
    const expr: Expression = brand({
      type: "spread",
      argument: toExpr(argument),
    });
    return typedExpr<T[number]>(expr, explicitExprType(expr, argument));
  },

  nullish: <L, R>(
    left: L,
    right: R,
  ): TypedExpression<NonNullable<InferValueType<L>> | InferValueType<R>> => {
    const expr: Expression = brand({
      type: "nullish",
      left: toExpr(left),
      right: toExpr(right),
    });
    return typedExpr<NonNullable<InferValueType<L>> | InferValueType<R>>(
      expr,
      explicitExprType(expr, left, right),
    );
  },

  new: <
    C extends
      | AnyMacroClass
      | ClassRef<any>
      | VarRef<any>
      | TypedExpression<any>
      | string,
    TArgs extends Array<TSTypeDescriptor | TypeRef<unknown>> | undefined = undefined,
  >(
    callee: C,
    args: C extends ClassRef<any> ?
      CallArgs<Parameters<ClassConstructorOf<C>>>
    : C extends AnyMacroClass ?
      CallArgs<Parameters<ClassConstructorOf<C>>>
    : C extends VarRef<infer Fn> ?
      Fn extends (...a: infer A) => any ?
        CallArgs<A>
      : unknown[]
    : unknown[],
    typeArgs?: TArgs,
  ): TypedExpression<
    C extends ClassRef<any> ? ClassInstanceOf<C>
    : C extends AnyMacroClass ? MacroClassInstanceType<C>
    : C extends VarRef<infer Fn> ?
      Fn extends (...a: any[]) => infer R ?
        R
      : unknown
    : unknown
  > => {
    const tsTypeArgs = typeArgs?.map(arg => toTypeDesc(arg) ?? types.unknown());
    const expr: Expression = brand({
      type: "new",
      callee:
        typeof callee === "string" ? brand({ type: "variable", name: callee })
        : isMacroClass(callee) ? brand({ type: "variable", name: getMacroDefinition(callee).name })
        : toExpr(callee),
      arguments: toExprList(args as unknown[]),
      typeArguments: tsTypeArgs,
    });

    return typedExpr<
      C extends ClassRef<any> ? ClassInstanceOf<C>
      : C extends AnyMacroClass ? MacroClassInstanceType<C>
      : C extends VarRef<infer Fn> ?
        Fn extends (...a: any[]) => infer R ?
          R
        : unknown
      : unknown
    >(
      expr,
      callee instanceof ClassRef ?
        toTypeDesc(callee.instanceTsType as DescriptorInput)
      : explicitExprType(expr, callee),
    );
  },

  this: (): Expression => {
    return brand({ type: "this" });
  },

  undefined: (): TypedExpression<undefined> => {
    return typedExpr<undefined>(brand({ type: "undefined" }), types.undefined());
  },

  call: (() => {
    type CallOverload = {
      <TFn extends (...args: any[]) => any>(
        callee: VarRef<TFn> | TypedExpression<TFn>,
        args: CallArgs<Parameters<TFn>>,
        typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
        returnType?: TypeInput,
      ): TypedExpression<ReturnType<TFn>>;
      <TReturn extends TypeInput | undefined = undefined>(
        callee: string,
        args: unknown[],
        typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
        returnType?: TReturn,
      ): TypedExpression<TReturn extends TypeInput ? ExtractType<TReturn> : unknown>;
    };

    const callImpl = (
      callee: VarRef<any> | TypedExpression<any> | string,
      args: unknown[],
      typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
      _returnType?: TypeInput,
    ): TypedExpression<unknown> => {
      const tsTypeArgs = typeArgs?.map(arg => toTypeDesc(arg) ?? types.unknown());
      const expr: Expression = brand({
        type: "call",
        callee:
          typeof callee === "string" ? brand({ type: "variable", name: callee }) : toExpr(callee),
        args: toExprList(args),
        typeArguments: tsTypeArgs,
      });

      const descriptor =
        toTypeDesc(_returnType as DescriptorInput) ??
        (typeof callee === "string" ? undefined : explicitExprType(expr, callee));

      return typedExpr<any>(expr, descriptor) as any;
    };

    return callImpl as CallOverload;
  })(),

  optionalProp: <
    TObj extends VarRef<unknown> | TypedExpression<unknown>,
    K extends keyof NonNullable<ExtractObjType<TObj>>,
  >(
    obj: TObj,
    key: K,
  ): TypedExpression<NonNullable<ExtractObjType<TObj>>[K] | undefined> => {
    const expr: Expression = brand({
      type: "optional-member",
      object: toExpr(obj),
      property: String(key),
    });
    return typedExpr<NonNullable<ExtractObjType<TObj>>[K] | undefined>(
      expr,
      explicitExprType(expr, obj),
    );
  },

  optionalCall: <TFn>(
    callee: VarRef<TFn> | TypedExpression<TFn>,
    args: NonNullable<TFn> extends (...a: infer A) => unknown ? A : unknown[],
  ): TypedExpression<
    (NonNullable<TFn> extends (...a: any[]) => infer R ? R : unknown) | undefined
  > => {
    const expr: Expression = brand({
      type: "optional-call",
      callee: toExpr(callee),
      arguments: toExprList(args as unknown[]),
    });
    return typedExpr<(NonNullable<TFn> extends (...a: any[]) => infer R ? R : unknown) | undefined>(
      expr,
      explicitExprType(expr, callee),
    );
  },

  as: <T extends TypeInput>(expr: unknown, typeAnnotation: T): TypedExpression<ExtractType<T>> => {
    const typeDesc = toTypeDesc(typeAnnotation) ?? types.unknown();
    const expression: Expression = brand({
      type: "as",
      expression: toExpr(expr),
      typeAnnotation: typeDesc,
    });
    return typedExpr<ExtractType<T>>(expression, typeDesc);
  },

  satisfies: <TExpr, TAnnot extends TypeInput>(
    expr: TExpr &
      (InferValueType<TExpr> extends ExtractType<TAnnot> ? unknown
      : ["DoesNotSatisfy", ExtractType<TAnnot>, InferValueType<TExpr>]),
    typeAnnotation: TAnnot,
  ): TypedExpression<InferValueType<TExpr>> => {
    const typeDesc = toTypeDesc(typeAnnotation) ?? types.unknown();
    const inputExpr = toExpr(expr);
    const expression: Expression = brand({
      type: "satisfies",
      expression: inputExpr,
      typeAnnotation: typeDesc,
    });
    return typedExpr<InferValueType<TExpr>>(
      expression,
      explicitExprType(inputExpr, expr) ?? inferExpressionType(inputExpr),
    );
  },

  nonNull: <T>(expr: VarRef<T> | TypedExpression<T>): TypedExpression<NonNullable<T>> => {
    const expression: Expression = brand({
      type: "non-null",
      expression: toExpr(expr),
    });
    return typedExpr<NonNullable<T>>(expression, explicitExprType(expression, expr));
  },

  optional: {
    prop: <
      TObj extends VarRef<unknown> | TypedExpression<unknown>,
      K extends keyof NonNullable<ExtractObjType<TObj>>,
    >(
      obj: TObj,
      key: K,
    ): TypedExpression<NonNullable<ExtractObjType<TObj>>[K] | undefined> => {
      return $.optionalProp(obj, key);
    },

    call: <TFn>(
      callee: VarRef<TFn> | TypedExpression<TFn>,
      args: NonNullable<TFn> extends (...a: infer A) => unknown ? A : unknown[],
    ): TypedExpression<
      (NonNullable<TFn> extends (...a: any[]) => infer R ? R : unknown) | undefined
    > => {
      return $.optionalCall(callee, args);
    },
  },

  *forOf<T, E = ExtractIterableElementType<T>>(
    variable: string,
    iterable: T,
    body: (loopVar: VarRef<E>) => Generator<Statement, any, any>,
  ): Generator<Statement, void, any> {
    const iterableExpr = toExpr(iterable);
    const loopVarType =
      inferIterableElementDescriptor(
        explicitExprType(iterableExpr, iterable) ?? inferExpressionType(iterableExpr),
      ) ?? types.unknown();
    const loopVar = new VarRef<E>(variable, loopVarType);
    const bodyStatements: Statement[] = [];

    for (const stmt of body(loopVar)) {
      bodyStatements.push(stmt);
    }

    const forStmt: Statement = {
      type: "for-of",
      variable,
      iterable: iterableExpr as Expression,
      body: bodyStatements,
    };

    yield forStmt;
  },

  p: <
    N extends string,
    T extends TypeInput,
    const Options extends ParamOptions | undefined = undefined,
  >(
    name: N,
    type: T,
    options?: Options,
  ): ParamDef<
    N,
    T,
    ParamOptionValue<Options, "optional"> extends boolean ? ParamOptionValue<Options, "optional">
    : undefined,
    ParamOptionValue<Options, "rest"> extends boolean ? ParamOptionValue<Options, "rest">
    : undefined,
    ParamOptionValue<Options, "default">
  > =>
    ({
      name,
      type,
      optional: options?.optional,
      rest: options?.rest,
      default: options?.default,
    }) as any,

  function: (() => {
    return function* <const Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      },
    ): Generator<Statement, VarRef<(...args: ParamDefsToTypes<Params>) => UnwrapReturn<R>>, any> {
      const paramArray = normalizeFunctionParams(params);
      const { ctx, argsByName } = createParamBindings(paramArray);
      const args = argsByName as ParamDefsToArgs<Params>;
      const { bodyStatements, inferredReturnType } = collectFunctionLikeBody(body(args), ctx);
      const providedReturnType = toTypeDesc(options?.returnType);
      const finalReturnType = finalizeReturnType(providedReturnType, inferredReturnType);

      const funcStmt: Statement = {
        type: "function",
        name,
        params: paramArray,
        body: bodyStatements,
        returnType: finalReturnType,
        typeParams: options?.typeParams,
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => UnwrapReturn<R>>(
        name,
        buildFunctionTsType(paramArray, finalReturnType),
      );
    };
  })(),

  block: (bodyFn: () => Generator<Statement, any, any>) => {
    const buildContext = createBuildContext();
    const statements = withBuildContext(buildContext, () => {
      const ctx = {
        variables: new Map<string, TSTypeDescriptor>(),
        buildContext,
      };
      const collected: Statement[] = [];
      for (const stmt of bodyFn()) {
        if (stmt.type === "const" || stmt.type === "let") {
          const inferred = inferExpressionType(stmt.value, ctx);
          const shouldReplace = !stmt.tsType || isUnknownish(stmt.tsType);
          if (shouldReplace) stmt.tsType = widenForDeclaration(inferred);
          ctx.variables.set(stmt.name, resolveDescriptor(stmt.tsType, ctx.buildContext));
        }
        collected.push(stmt);
      }
      return collected;
    });

    return {
      context: buildContext,
      toBabelAST: () => t.blockStatement(statements.map(statementToBabel)),
    };
  },

  if: <T = void>(
    condition: unknown,
    then: () => Generator<Statement, T, any>,
    elseBlock?: () => Generator<Statement, T, any>,
  ): Generator<Statement, T | undefined, any> => {
    return (function* () {
      const condExpr = toExpr(condition);

      const thenStatements: Statement[] = [];
      const thenGen = then();
      let thenResult = thenGen.next();
      while (!thenResult.done) {
        thenStatements.push(thenResult.value as Statement);
        thenResult = thenGen.next();
      }

      const elseStatements: Statement[] = [];
      let elseResult: any;
      if (elseBlock) {
        const elseGen = elseBlock();
        let elseGenResult = elseGen.next();
        while (!elseGenResult.done) {
          elseStatements.push(elseGenResult.value as Statement);
          elseGenResult = elseGen.next();
        }
        elseResult = elseGenResult.value;
      }

      const ifStmt: Statement = {
        type: "if",
        condition: condExpr,
        then: thenStatements,
        else: elseStatements.length > 0 ? elseStatements : undefined,
      };

      yield ifStmt;
      return elseBlock ? elseResult : thenResult.value;
    })();
  },

  return: <T>(value?: T): Statement => {
    return {
      type: "return",
      value: value === undefined ? undefined : normalizeToExpression(value),
    };
  },

  *throw(argument: unknown): Generator<Statement, void, any> {
    yield { type: "throw", argument: toExpr(argument) };
  },

  *break(label?: string): Generator<Statement, void, any> {
    yield { type: "break", label };
  },

  *continue(label?: string): Generator<Statement, void, any> {
    yield { type: "continue", label };
  },

  *while(
    test: unknown,
    body: () => Generator<Statement, any, any>,
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "while",
      test: toExpr(test),
      body: bodyStatements,
    };
  },

  *doWhile(
    body: () => Generator<Statement, any, any>,
    test: unknown,
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "do-while",
      body: bodyStatements,
      test: toExpr(test),
    };
  },

  *type<D extends TSTypeDescriptor>(
    name: string,
    definition: D,
    typeParams?: string[],
  ): Generator<Statement, TypeRef<InferTSType<D>>, any> {
    const stmt: Statement = {
      type: "type-alias",
      name,
      definition,
      typeParams,
    };
    yield stmt;
    registerTypeAlias(name, definition);
    return new TypeRef<InferTSType<D>>(name, { kind: "reference", name }, definition);
  },

  *interface<T extends Record<string, TSTypeDescriptor>>(
    name: string,
    properties: T,
    typeParams?: string[],
  ): Generator<Statement, TypeRef<{ [K in keyof T]: InferTSType<T[K]> }>, any> {
    const stmt: Statement = {
      type: "interface",
      name,
      properties,
      typeParams,
    };
    yield stmt;
    const descriptor = type.object(properties);
    registerTypeAlias(name, descriptor);
    return new TypeRef<{ [K in keyof T]: InferTSType<T[K]> }>(
      name,
      {
        kind: "reference",
        name,
      },
      descriptor,
    );
  },

  arrow: <
    Body extends Expression | Statement[] | (() => Generator<Statement, any, any>),
    const ParamsInput extends readonly ArrowParamInput[],
  >(
    params: ParamsInput,
    body: Body,
    opts?: {
      async?: boolean;
      returnType?: TSTypeDescriptor | TypeRef<unknown>;
    },
  ): TypedExpression<
    (
      ...args: ArrowParamsToTuple<ParamsInput>
    ) => Body extends Expression ? UnwrapReturn<Body> : unknown
  > => {
    const paramArray = params.map(p =>
      normalizeParam({
        name: p.name,
        tsType: toTypeDesc(p.tsType),
        optional: p.optional,
        rest: p.rest,
        default: p.default,
      }),
    );

    let bodyValue: Expression | Statement[];
    if (typeof body === "function") {
      const bodyStatements: Statement[] = [];
      for (const stmt of body()) {
        bodyStatements.push(stmt);
      }
      bodyValue = bodyStatements;
    } else if (Array.isArray(body)) {
      bodyValue = body;
    } else {
      bodyValue = body;
    }

    const expr: Expression = brand({
      type: "arrow",
      params: paramArray,
      body: bodyValue,
      async: opts?.async,
      returnType: toTypeDesc(opts?.returnType),
    });

    return typedExpr<
      (
        ...args: ArrowParamsToTuple<ParamsInput>
      ) => Body extends Expression ? UnwrapReturn<Body> : unknown
    >(expr, buildFunctionTsType(paramArray, toTypeDesc(opts?.returnType)));
  },

  update: (operator: "++" | "--", expr: any, prefix: boolean = false): TypedExpression<number> => {
    const expression: Expression = brand({
      type: "update",
      operator,
      argument: toExpr(expr),
      prefix,
    });
    return typedExpr<number>(expression, types.number());
  },

  taggedTemplate: <TTag extends (...args: any[]) => unknown>(
    tag: VarRef<TTag> | TypedExpression<TTag> | string,
    template: TemplateExpression | TypedExpression<string>,
  ): TypedExpression<ReturnType<TTag>> => {
    const expr: Expression = brand({
      type: "tagged-template",
      tag: typeof tag === "string" ? brand({ type: "variable", name: tag }) : toExpr(tag),
      quasi: template as TemplateExpression,
    });
    return typedExpr<ReturnType<TTag>>(
      expr,
      typeof tag === "string" ? undefined : explicitExprType(expr, tag),
    );
  },

  assign: <TLeft>(
    left: VarRef<TLeft> | TypedExpression<TLeft>,
    right: unknown,
    op: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&&=" | "||=" | "??=" = "=",
  ): TypedExpression<TLeft> => {
    const expr: Expression = brand({
      type: "assignment",
      operator: op,
      left: toExpr(left),
      right: toExpr(right),
    });
    return typedExpr<TLeft>(expr, explicitExprType(expr, left));
  },

  *assignProps(
    target: VarRef<unknown> | TypedExpression<unknown>,
    props: Record<string, unknown>,
  ): Generator<Statement, void, any> {
    const targetExpr: Expression = toExpr(target);

    for (const [prop, value] of Object.entries(props)) {
      const left: Expression = brand({
        type: "member",
        object: targetExpr,
        property: prop,
      });
      const right = normalizeToExpression(value);
      const expr: Expression = brand({
        type: "assignment",
        operator: "=",
        left,
        right,
      });
      yield { type: "expression", expr };
    }
  },

  *switch(
    discriminant: unknown,
    casesBuilder: () => Array<
      | { test: unknown; body: () => Generator<Statement, any, any> }
      | { default: true; body: () => Generator<Statement, any, any> }
    >,
  ): Generator<Statement, void, any> {
    const caseConfigs = casesBuilder();
    const cases: Array<{ test: Expression | null; consequent: Statement[] }> = [];

    for (const config of caseConfigs) {
      if ("default" in config) {
        const bodyStatements: Statement[] = [];
        for (const stmt of config.body()) {
          bodyStatements.push(stmt);
        }
        cases.push({ test: null, consequent: bodyStatements });
      } else {
        const bodyStatements: Statement[] = [];
        for (const stmt of config.body()) {
          bodyStatements.push(stmt);
        }
        cases.push({ test: toExpr(config.test), consequent: bodyStatements });
      }
    }

    yield { type: "switch", discriminant: toExpr(discriminant), cases };
  },

  case: (test: unknown, body: () => Generator<Statement, any, any>) => {
    return { test, body };
  },

  default: (body: () => Generator<Statement, any, any>) => {
    return { default: true as const, body };
  },

  *try(
    block: () => Generator<Statement, any, any>,
    options?: {
      catch?: {
        param?: string | { name: string; type: TSTypeDescriptor | TypeRef<unknown> };
        body: () => Generator<Statement, any, any>;
      };
      finally?: () => Generator<Statement, any, any>;
    },
  ): Generator<Statement, void, any> {
    const blockStatements: Statement[] = [];
    for (const stmt of block()) {
      blockStatements.push(stmt);
    }

    let handler:
      | { param?: { name: string; type?: TSTypeDescriptor }; body: Statement[] }
      | undefined;
    if (options?.catch) {
      const catchBody: Statement[] = [];
      for (const stmt of options.catch.body()) {
        catchBody.push(stmt);
      }

      if (options.catch.param) {
        if (typeof options.catch.param === "string") {
          handler = {
            param: { name: options.catch.param },
            body: catchBody,
          };
        } else {
          const typeDesc = toTypeDesc(options.catch.param.type);
          handler = {
            param: { name: options.catch.param.name, type: typeDesc },
            body: catchBody,
          };
        }
      } else {
        handler = { body: catchBody };
      }
    }

    let finalizer: Statement[] | undefined;
    if (options?.finally) {
      finalizer = [];
      for (const stmt of options.finally()) {
        finalizer.push(stmt);
      }
    }

    yield { type: "try", block: blockStatements, handler, finalizer };
  },

  classProperty: createClassPropertyMember,

  constructor: function* <const Params extends readonly ParamDef[], R = void>(
    params: [...Params],
    body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, unknown>,
  ): ConstructorMember<Params> {
    const paramArray = normalizeFunctionParams(params);
    const ref = new ClassMemberRef<(...args: ParamDefsToTypes<Params>) => void>(
      "constructor",
      "constructor",
      buildFunctionTsType(paramArray),
      { kind: "constructor" },
    ) as ConstructorRef<Params>;

    const member: YieldedClassMember<
      ConstructorRef<Params>,
      { type: "method"; key: "constructor"; kind: "constructor" }
    > &
      ClassMember & {
        [FinalizeClassMember]: (thisDesc?: TSTypeDescriptor) => void;
      } = {
      type: "method",
      key: "constructor",
      kind: "constructor",
      params: paramArray,
      body: [],
      ref,
      [FinalizeClassMember]: () => {
        const { ctx, argsByName } = createParamBindings(paramArray);
        const args = argsByName as ParamDefsToArgs<Params>;
        const { bodyStatements } = collectFunctionLikeBody(body(args), ctx);
        (member as ClassMember & { body: Statement[] }).body = bodyStatements;
        ref.tsType = buildFunctionTsType(paramArray);
      },
    };
    const injected = yield member;
    return (injected as ConstructorRef<Params> | undefined) ?? ref;
  },

  classMethod: createClassMethod,

  class: createClass,

  *enum<const Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>>(
    name: string,
    members: Members,
    options?: {
      const?: boolean;
    },
  ): Generator<Statement, VarRef<EnumShapeFrom<Members>>, any> {
    const enumMembers: EnumMember[] = members.map(member => {
      if (typeof member === "string") {
        return { id: member };
      } else {
        return {
          id: member.id,
          initializer:
            "initializer" in member ? normalizeToExpression(member.initializer) : undefined,
        };
      }
    });

    const stmt: Statement = {
      type: "enum",
      id: name,
      members: enumMembers,
      const: options?.const,
    };

    yield stmt;
    const literalInitializers =
      enumMembers.length > 0 && enumMembers.every(m => m.initializer?.type === "literal");
    const enumDescriptor: TSTypeDescriptor =
      literalInitializers ?
        {
          kind: "union",
          types: enumMembers.map(m => types.literal((m.initializer as any).value as any)),
        }
      : types.number();

    registerTypeAlias(name, enumDescriptor);

    type EnumShape = EnumShapeFrom<Members>;

    return new VarRef<EnumShape>(name, enumDescriptor);
  },

  import: Object.assign(
    function* (
      specifiers: Array<
        { imported: string; local?: string } | { default: string } | { namespace: string }
      >,
      source: string,
      typeOnly?: boolean,
    ): Generator<Statement, void, any> {
      const importSpecifiers: any[] = specifiers.map(spec => {
        if ("default" in spec) {
          return { type: "default", local: spec.default };
        } else if ("namespace" in spec) {
          return { type: "namespace", local: spec.namespace };
        } else {
          return {
            type: "specifier",
            imported: spec.imported,
            local: spec.local,
          };
        }
      });

      yield {
        type: "import",
        specifiers: importSpecifiers,
        source,
        typeOnly,
      };
    },
    {
      default: function* (local: string, source: string): Generator<Statement, void, any> {
        yield {
          type: "import",
          specifiers: [{ type: "default", local }],
          source,
        };
      },

      namespace: function* (local: string, source: string): Generator<Statement, void, any> {
        yield {
          type: "import",
          specifiers: [{ type: "namespace", local }],
          source,
        };
      },
    },
  ),

  export: {
    named: function* (
      declarationOrSpecifiers: Statement | Array<{ local: string; exported?: string }>,
      source?: string,
      typeOnly?: boolean,
    ): Generator<Statement, void, any> {
      if (Array.isArray(declarationOrSpecifiers)) {
        yield {
          type: "export-named",
          specifiers: declarationOrSpecifiers,
          source,
          typeOnly,
        };
      } else {
        yield {
          type: "export-named",
          declaration: declarationOrSpecifiers,
          typeOnly,
        };
      }
    },

    default: function* (declaration: Expression | Statement): Generator<Statement, void, any> {
      yield {
        type: "export-default",
        declaration,
      };
    },

    all: function* (source: string, exported?: string): Generator<Statement, void, any> {
      yield {
        type: "export-all",
        source,
        exported,
      };
    },
  },

  *namespace(
    name: string,
    bodyGenerator: () => Generator<Statement, any, any>,
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of bodyGenerator()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "namespace",
      id: name,
      body: bodyStatements,
    };
  },

  *declare(statement: Statement): Generator<Statement, void, any> {
    yield {
      type: "declare",
      declaration: statement,
    };
  },

  *expression(expr: unknown): Generator<Statement, void, any> {
    yield {
      type: "expression",
      expr: normalizeToExpression(expr),
    };
  },

  *raw(code: string): Generator<Statement, void, any> {
    yield { type: "raw-stmt", code };
  },

  async: (() => {
    return function* <const Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      },
    ): Generator<
      Statement,
      VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>,
      any
    > {
      const paramArray = normalizeFunctionParams(params);
      const { ctx, argsByName } = createParamBindings(paramArray);
      const args = argsByName as ParamDefsToArgs<Params>;
      const { bodyStatements, inferredReturnType } = collectFunctionLikeBody(body(args), ctx);
      const providedReturnType = toTypeDesc(options?.returnType);
      const finalReturnType = finalizeReturnType(providedReturnType, inferredReturnType);
      const promisedReturnType: TSTypeDescriptor = {
        kind: "generic",
        name: "Promise",
        args: [finalReturnType ?? types.unknown()],
      };

      const funcStmt: Statement = {
        type: "function",
        name,
        params: paramArray,
        body: bodyStatements,
        returnType: promisedReturnType,
        typeParams: options?.typeParams,
        async: true,
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>(
        name,
        buildFunctionTsType(paramArray, promisedReturnType),
      );
    };
  })(),
};

export const numeric = {
  add: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "+",
      right: toExpr(right),
    });
    return typedExpr<number>(expr, types.number());
  },

  multiply: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "*",
      right: toExpr(right),
    });
    return typedExpr<number>(expr, types.number());
  },

  subtract: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "-",
      right: toExpr(right),
    });
    return typedExpr<number>(expr, types.number());
  },

  divide: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "/",
      right: toExpr(right),
    });
    return typedExpr<number>(expr, types.number());
  },
};

export const compare = {
  eq: <T>(left: ComparableInput<T>, right: ComparableInput<T>): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "===",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  neq: <T>(left: ComparableInput<T>, right: ComparableInput<T>): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "!==",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  lt: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "<",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  lte: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "<=",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  gt: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: ">",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  gte: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: ">=",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },
};

export const str = {
  concat: <L, R>(left: L, right: R): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "+",
      right: toExpr(right),
    });
    return typedExpr<string>(expr, types.string());
  },

  length: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "member",
      object: toExpr(str),
      property: "length",
    });
    return typedExpr<number>(expr, types.number());
  },

  toUpperCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: toExpr(str),
        property: "toUpperCase",
      }),
      args: [],
    });
    return typedExpr<string>(expr, types.string());
  },

  toLowerCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: toExpr(str),
        property: "toLowerCase",
      }),
      args: [],
    });
    return typedExpr<string>(expr, types.string());
  },

  slice: <T>(
    str: VarRef<string> | TypedExpression<string>,
    start: number | VarRef<number>,
    end?: number | VarRef<number>,
  ): TypedExpression<string> => {
    const args: Expression[] = [toExpr(start)];

    if (end !== undefined) {
      args.push(toExpr(end));
    }

    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: toExpr(str),
        property: "slice",
      }),
      args,
    });
    return typedExpr<string>(expr, types.string());
  },
};

export const logic = {
  not: (operand: BooleanLike): TypedExpression<boolean> => $.not(operand),

  and: (left: BooleanLike, right: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "&&",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },

  or: (left: BooleanLike, right: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left: toExpr(left),
      op: "||",
      right: toExpr(right),
    });
    return typedExpr<boolean>(expr, types.boolean());
  },
};

export const type = {
  string: types.string,
  number: types.number,
  boolean: types.boolean,
  any: types.any,
  void: types.void,
  undefined: types.undefined,
  null: types.null,
  never: types.never,
  unknown: types.unknown,

  array: types.array,
  union: types.union,
  intersection: types.intersection,
  function: types.function,
  object: types.object,
  generic: types.generic,
  reference: types.reference,
  promise: types.promise,
  literal: types.literal,
  tuple: types.tuple,
  keyof: types.keyof,
  typeof: types.typeof,
  typeQuery: types.typeQuery,
  indexedAccess: types.indexedAccess,
  conditional: types.conditional,
  mapped: types.mapped,
  templateLiteral: types.templateLiteral,
  infer: types.infer,
};

export const createInterface = (
  name: string,
  properties: Record<string, TSTypeDescriptor>,
  typeParams?: string[],
) => {
  const props = Object.entries(properties).map(([key, type]) => {
    return t.tsPropertySignature(
      t.identifier(key),
      t.tsTypeAnnotation(typeDescriptorToTSType(type)),
    );
  });

  const typeParameters = typeParams?.map(param => t.tsTypeParameter(null, null, param)) || null;

  return t.tsInterfaceDeclaration(
    t.identifier(name),
    typeParameters ? t.tsTypeParameterDeclaration(typeParameters) : null,
    null,
    t.tsInterfaceBody(props),
  );
};

export const createTypeAlias = (name: string, type: TSTypeDescriptor, typeParams?: string[]) => {
  const typeParameters = typeParams?.map(param => t.tsTypeParameter(null, null, param)) || null;

  return t.tsTypeAliasDeclaration(
    t.identifier(name),
    typeParameters ? t.tsTypeParameterDeclaration(typeParameters) : null,
    typeDescriptorToTSType(type),
  );
};
