import type { Expression, TSTypeDescriptor } from "./ir";
import { isExpr, brand } from "./ir";
import { ClassMemberRef, VarRef, TypeRef } from "./refs";
import { getTypedExprDescriptor } from "./types";
import type { TypedDescriptor, TypeInput, ExtractType, GenericTypeResult, InferTSType, InferParamTuple, NormalizeParams, UnionToIntersection } from "./types";
import { defaultBuildContext, getActiveBuildContext, lookupClass, lookupTypeAlias } from "./context";
export { typeAliasRegistry, classRegistry } from "./context";

type ObjectPropInput = TypeInput | { type: TypeInput; optional?: boolean; readonly?: boolean };

type ObjectPropType<P> =
  P extends { type: infer T }
    ? ExtractType<T>
    : ExtractType<P>;

type OptionalObjectKeys<P> = {
  [K in keyof P]-?: P[K] extends { optional: true } ? K : never;
}[keyof P];

type ReadonlyObjectKeys<P> = {
  [K in keyof P]-?: P[K] extends { readonly: true } ? K : never;
}[keyof P];

type RequiredObjectKeys<P> = Exclude<keyof P, OptionalObjectKeys<P>>;
type WritableObjectKeys<P> = Exclude<keyof P, ReadonlyObjectKeys<P>>;
type ExpandObjectShape<T> = { [K in keyof T]: T[K] };

type TypeInputValue<T extends TypeInput> =
  T extends TypeRef<infer U> ? U
  : T extends { __phantom: infer U } ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

type IndexedAccessValue<Obj, Key> =
  [Obj] extends [never] ? unknown
  : unknown extends Obj ? unknown
  : [Key] extends [never] ? unknown
  : Key extends keyof Obj ? Obj[Key]
  : unknown;

type IndexedAccessPhantom<O extends TypeInput, I extends TypeInput> =
  IndexedAccessValue<NonNullable<TypeInputValue<O>>, TypeInputValue<I>>;

type ObjectPhantomShape<P extends Record<string, ObjectPropInput>> = ExpandObjectShape<
  { [K in Exclude<RequiredObjectKeys<P>, ReadonlyObjectKeys<P>>]: ObjectPropType<P[K]> } &
  { readonly [K in Extract<RequiredObjectKeys<P>, ReadonlyObjectKeys<P>>]: ObjectPropType<P[K]> } &
  { [K in Exclude<OptionalObjectKeys<P>, ReadonlyObjectKeys<P>>]?: ObjectPropType<P[K]> } &
  { readonly [K in Extract<OptionalObjectKeys<P>, ReadonlyObjectKeys<P>>]?: ObjectPropType<P[K]> }
>;

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

const functionDescriptor = (
  params: TSTypeDescriptor[],
  returnType: TSTypeDescriptor
): TSTypeDescriptor => ({
  kind: "function",
  params,
  returnType
});

const inferPrimitiveMemberType = (
  primitive: "string" | "number" | "boolean",
  propertyKey: string
): TSTypeDescriptor | undefined => {
  switch (primitive) {
    case "string":
      switch (propertyKey) {
        case "length":
          return types.number();
        case "toUpperCase":
        case "toLowerCase":
        case "trim":
        case "trimStart":
        case "trimEnd":
        case "toString":
        case "valueOf":
          return functionDescriptor([], types.string());
        case "slice":
        case "substring":
          return functionDescriptor([types.number(), types.number()], types.string());
        case "charAt":
          return functionDescriptor([types.number()], types.string());
        case "repeat":
          return functionDescriptor([types.number()], types.string());
        case "includes":
        case "startsWith":
        case "endsWith":
          return functionDescriptor([types.string()], types.boolean());
        case "indexOf":
          return functionDescriptor([types.string()], types.number());
        case "split":
          return functionDescriptor([types.string()], types.array(types.string()));
        default:
          return undefined;
      }

    case "number":
      switch (propertyKey) {
        case "toString":
          return functionDescriptor([], types.string());
        case "valueOf":
          return functionDescriptor([], types.number());
        case "toFixed":
        case "toPrecision":
          return functionDescriptor([types.number()], types.string());
        default:
          return undefined;
      }

    case "boolean":
      switch (propertyKey) {
        case "toString":
          return functionDescriptor([], types.string());
        case "valueOf":
          return functionDescriptor([], types.boolean());
        default:
          return undefined;
      }
  }
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
    UnionToIntersection<ExtractType<T[number]>>,
    { kind: "intersection"; types: TSTypeDescriptor[] }
  > => ({ kind: "intersection", types: types.map(toDescriptor) }) as any,

  function: <const P extends readonly TSTypeDescriptor[], R extends TSTypeDescriptor>(
    params: P,
    returnType: R
  ): TypedDescriptor<
    (...args: InferParamTuple<NormalizeParams<P>>) => InferTSType<R>,
    { kind: "function"; params: TSTypeDescriptor[]; returnType: TSTypeDescriptor }
  > => ({ kind: "function", params, returnType }) as any,

  object: <P extends Record<string, ObjectPropInput>>(properties: P): TypedDescriptor<
    ObjectPhantomShape<P>,
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

  generic: <N extends string, A extends TypeInput[]>(name: N, ...args: A) => {
    const descriptors = args.map(toDescriptor);
    return {
      kind: "generic" as const,
      name,
      args: descriptors
    } as TypedDescriptor<GenericTypeResult<N, typeof descriptors>, { kind: "generic"; name: N; args: TSTypeDescriptor[] }>;
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

  literal: <const V extends string | number | boolean | null>(value: V): TypedDescriptor<
    V,
    { kind: "literal"; value: V }
  > => ({ kind: "literal", value }) as any,

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
    { kind: "typeof"; name: string; __phantom: T }
  > => ({
    kind: "typeof",
    name: typeof value === "string" ? value : value.name,
    __phantom: undefined as T
  }) as any,

  typeQuery: <T>(value: string | VarRef<T>): TypedDescriptor<
    T,
    { kind: "typeof"; name: string; __phantom: T }
  > => ({
    kind: "typeof",
    name: typeof value === "string" ? value : value.name,
    __phantom: undefined as T
  }) as any,

  indexedAccess: <O extends TypeInput, I extends TypeInput>(
    objectType: O,
    indexType: I
  ): TypedDescriptor<
    IndexedAccessPhantom<O, I>,
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

export function normalizeToExpression(value: unknown): Expression {
  if (value === undefined) {
    return brand({ type: "undefined" });
  }

  if (isExpr(value)) {
    return value;
  }

  if (value instanceof ClassMemberRef) {
    return brand({
      type: "member",
      object: brand({ type: "this" }),
      property: value.memberKey
    });
  }

  if (value instanceof VarRef) return brand({ type: "variable", name: value.name });
  if (typeof value === "string") return brand({ type: "literal", value });
  if (typeof value === "number") return brand({ type: "literal", value });
  if (typeof value === "boolean") return brand({ type: "literal", value });
  if (value === null) return brand({ type: "literal", value: null });

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
  buildContext?: import("./context").BuildContext;
};

function getLiteralMemberKey(property: string | Expression): string | number | undefined {
  if (typeof property === "string") {
    return /^\d+$/.test(property) ? Number(property) : property;
  }

  if (property.type === "literal") {
    if (typeof property.value === "string" || typeof property.value === "number") {
      return property.value;
    }
  }

  return undefined;
}

function inferMemberTypeFromResolvedType(
  objType: TSTypeDescriptor,
  propertyKey: string | number | undefined,
  computed: boolean,
  ctx: InferenceContext,
  optional: boolean
): TSTypeDescriptor | undefined {
  const buildContext = ctx.buildContext ?? getActiveBuildContext();
  const resolvedObject = resolveDescriptor(objType, buildContext);

  if (resolvedObject.kind === "union") {
    const variantTypes: TSTypeDescriptor[] = [];
    for (const variant of resolvedObject.types) {
      const resolvedVariant = resolveDescriptor(variant, buildContext);
      if (optional && isNullishPrimitive(resolvedVariant)) {
        continue;
      }

      const variantType = inferMemberTypeFromResolvedType(
        resolvedVariant,
        propertyKey,
        computed,
        ctx,
        optional
      );
      if (!variantType) return undefined;
      variantTypes.push(variantType);
    }
    if (variantTypes.length === 0 && optional) {
      return types.undefined();
    }
    return unionFromTypes(variantTypes);
  }

  if (resolvedObject.kind === "object" && typeof propertyKey === "string" && propertyKey in resolvedObject.properties) {
    const prop = resolvedObject.properties[propertyKey]!;
    const base = (prop as any)?.type ? (prop as any).type as TSTypeDescriptor : prop as TSTypeDescriptor;
    const resolved = resolveDescriptor(base, buildContext);
    const propertyType = (prop as any)?.optional ? _t.union(resolved, types.undefined()) : resolved;
    return optional ? _t.union(propertyType, types.undefined()) : propertyType;
  }

  if (resolvedObject.kind === "array") {
    if (propertyKey === "length") {
      return optional ? _t.union(types.number(), types.undefined()) : types.number();
    }
    if (typeof propertyKey === "number" || computed) {
      return optional ? _t.union(resolvedObject.elementType, types.undefined()) : resolvedObject.elementType;
    }
  }

  if (resolvedObject.kind === "tuple") {
    const idx = typeof propertyKey === "number" ? propertyKey : Number.NaN;
    if (!Number.isNaN(idx) && idx < resolvedObject.types.length) {
      const element = resolvedObject.types[idx]!;
      const base = (element as any)?.type ? (element as any).type as TSTypeDescriptor : element as TSTypeDescriptor;
      const resolved = resolveDescriptor(base, buildContext);
      const propertyType = (element as any)?.optional ? _t.union(resolved, types.undefined()) : resolved;
      return optional ? _t.union(propertyType, types.undefined()) : propertyType;
    }
  }

  if (resolvedObject.kind === "primitive" && typeof propertyKey === "string") {
    const memberType =
      resolvedObject.name === "string" || resolvedObject.name === "number" || resolvedObject.name === "boolean"
        ? inferPrimitiveMemberType(resolvedObject.name, propertyKey)
        : undefined;

    if (memberType) {
      return optional ? _t.union(memberType, types.undefined()) : memberType;
    }
  }

  if (resolvedObject.kind === "literal" && typeof propertyKey === "string") {
    const primitive =
      typeof resolvedObject.value === "string" ? "string"
      : typeof resolvedObject.value === "number" ? "number"
      : typeof resolvedObject.value === "boolean" ? "boolean"
      : undefined;

    if (primitive) {
      const memberType = inferPrimitiveMemberType(primitive, propertyKey);
      if (memberType) {
        return optional ? _t.union(memberType, types.undefined()) : memberType;
      }
    }
  }

  return undefined;
}

function inferCallableReturnType(
  calleeType: TSTypeDescriptor,
  optional: boolean,
  buildContext = getActiveBuildContext()
): TSTypeDescriptor | undefined {
  const resolved = resolveDescriptor(calleeType, buildContext);

  if (resolved.kind === "function") {
    return optional ? unionFromTypes([resolved.returnType, types.undefined()]) : resolved.returnType;
  }

  if (resolved.kind === "union") {
    const returnTypes: TSTypeDescriptor[] = [];
    let sawNullish = false;

    for (const variant of resolved.types) {
      const resolvedVariant = resolveDescriptor(variant, buildContext);
      if (isNullishPrimitive(resolvedVariant)) {
        sawNullish = true;
        continue;
      }

      const variantReturn = inferCallableReturnType(resolvedVariant, false, buildContext);
      if (!variantReturn) return undefined;
      returnTypes.push(variantReturn);
    }

    if (returnTypes.length === 0) {
      return optional ? types.undefined() : undefined;
    }

    const callableReturn = unionFromTypes(returnTypes);
    return optional || sawNullish
      ? unionFromTypes([callableReturn, types.undefined()])
      : callableReturn;
  }

  return undefined;
}

function unionFromTypes(typesList: TSTypeDescriptor[]): TSTypeDescriptor {
  const buildContext = getActiveBuildContext();
  const uniqueTypes = deduplicateTypes(typesList.map(type => resolveDescriptor(type, buildContext)));
  if (uniqueTypes.length === 0) return types.unknown();
  if (uniqueTypes.length === 1) return uniqueTypes[0]!;
  return _t.union(...uniqueTypes);
}

function deduplicateTypes(types: TSTypeDescriptor[]): TSTypeDescriptor[] {
  const seen = new Set<string>();
  return types.filter(t => {
    const key = JSON.stringify(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveDescriptor(
  descriptor?: TSTypeDescriptor,
  buildContext = getActiveBuildContext()
): TSTypeDescriptor {
  if (!descriptor) return types.unknown();
  if ((descriptor as any).resolved) {
    return resolveDescriptor((descriptor as any).resolved as TSTypeDescriptor, buildContext);
  }
  if (descriptor.kind === "reference") {
    const target =
      lookupTypeAlias(descriptor.name, buildContext)
      ?? lookupClass(descriptor.name, buildContext);
    if (target) {
      if (target.kind === "reference" && target.name === descriptor.name && !(target as any).resolved) {
        return descriptor;
      }
      return resolveDescriptor(target, buildContext);
    }
  }
  return descriptor;
}

export function inferExpressionType(
  expr: Expression,
  ctx: InferenceContext = { variables: new Map(), buildContext: defaultBuildContext }
): TSTypeDescriptor {
  const buildContext = ctx.buildContext ?? getActiveBuildContext();
  const explicit = getTypedExprDescriptor(expr);
  if (explicit) return resolveDescriptor(explicit, buildContext);
  switch (expr.type) {
    case "literal":
      return types.literal(expr.value);

    case "variable":
      return resolveDescriptor(ctx.variables.get(expr.name) ?? types.unknown(), buildContext);

    case "undefined":
      return types.undefined();

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
      return inferCallableReturnType(calleeType, false, buildContext) ?? types.unknown();

    case "optional-call": {
      const calleeType = inferExpressionType(expr.callee, ctx);
      return inferCallableReturnType(calleeType, true, buildContext)
        ?? _t.union(types.undefined(), types.unknown());
    }

    case "member":
      const propertyKey = getLiteralMemberKey(expr.property);
      return inferMemberTypeFromResolvedType(
        inferExpressionType(expr.object, ctx),
        propertyKey,
        !!expr.computed,
        ctx,
        false
      ) ?? types.unknown();

    case "optional-member": {
      const propertyKey = getLiteralMemberKey(expr.property);
      return inferMemberTypeFromResolvedType(
        inferExpressionType(expr.object, ctx),
        propertyKey,
        !!expr.computed,
        ctx,
        true
      ) ?? _t.union(types.undefined(), types.unknown());
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
        const registered = lookupClass(expr.callee.name, buildContext);
        if (registered) return registered;
      }
      if (expr.typeArguments && expr.typeArguments.length > 0) {
        return resolveDescriptor(expr.typeArguments[0]!, buildContext);
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
      return unionFromTypes([consequentType, alternateType]);

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
      return resolveDescriptor(ctx.variables.get("this") ?? types.unknown(), buildContext);

    case "arrow": {
      const paramTypes = expr.params.map(p => {
        const base = resolveDescriptor(p.tsType ?? types.unknown(), buildContext);
        return p.optional ? _t.union(base, types.undefined()) : base;
      });

      const fnCtx: InferenceContext = { variables: new Map(ctx.variables), buildContext };
      expr.params.forEach((p, idx) => {
        fnCtx.variables.set(p.name, paramTypes[idx]!);
      });
      let returnType: TSTypeDescriptor = expr.returnType ? resolveDescriptor(expr.returnType, buildContext) : types.unknown();

      if (!expr.returnType) {
        if (Array.isArray(expr.body)) {
          returnType = inferStatementsReturnType(expr.body, fnCtx) ?? types.unknown();
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

export function inferStatementsReturnType(
  statements: Array<{ type: string } & Record<string, unknown>>,
  ctx: InferenceContext = { variables: new Map(), buildContext: defaultBuildContext }
): TSTypeDescriptor | undefined {
  const returnTypes: TSTypeDescriptor[] = [];

  const visit = (block: Array<{ type: string } & Record<string, unknown>>) => {
    for (const stmt of block) {
      switch (stmt.type) {
        case "return": {
          const value = stmt.value as Expression | undefined;
          returnTypes.push(value ? inferExpressionType(value, ctx) : types.void());
          break;
        }

        case "if":
          visit(stmt.then as Array<{ type: string } & Record<string, unknown>>);
          if (Array.isArray(stmt.else)) {
            visit(stmt.else as Array<{ type: string } & Record<string, unknown>>);
          }
          break;

        case "block":
          visit(stmt.body as Array<{ type: string } & Record<string, unknown>>);
          break;

        case "switch":
          for (const switchCase of stmt.cases as Array<{ consequent: Array<{ type: string } & Record<string, unknown>> }>) {
            visit(switchCase.consequent);
          }
          break;

        case "try":
          visit(stmt.block as Array<{ type: string } & Record<string, unknown>>);
          if (stmt.handler && typeof stmt.handler === "object") {
            visit((stmt.handler as { body: Array<{ type: string } & Record<string, unknown>> }).body);
          }
          if (Array.isArray(stmt.finalizer)) {
            visit(stmt.finalizer as Array<{ type: string } & Record<string, unknown>>);
          }
          break;

        case "for-of":
        case "for-in":
        case "while":
        case "do-while":
          visit(stmt.body as Array<{ type: string } & Record<string, unknown>>);
          break;

        default:
          break;
      }
    }
  };

  visit(statements);

  if (returnTypes.length === 0) {
    return undefined;
  }

  return unionFromTypes(returnTypes);
}
