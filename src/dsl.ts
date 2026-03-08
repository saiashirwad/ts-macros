import * as t from "@babel/types";
import type { Expression, Statement, TSTypeDescriptor, TemplateExpression, ClassMember, Param, TypeParameter, EnumMember } from "./ir";
import { brand, isExpr } from "./ir";
import { VarRef, TypeRef, ClassRef, createTypedVarRef } from "./refs";
import { statementToBabel, generate, typeDescriptorToTSType, parseTypeString } from "./babel";
import { types, normalizeToExpression, inferExpressionType, inferStatementsReturnType, resolveDescriptor, typeAliasRegistry, classRegistry } from "./infer";
import type { TypedExpression, StringExpr, NumberExpr, BoolExpr, ArrayExpr, InferValueType, ExtractType, ExtractIterableElementType, InferTSType, UnwrapRef, ExtractObjType, ExtractFnType, CallArgs, ParamSchemaToObjectArg, TypeInput, ParamDef, ParamDefsToArgs, ParamDefsToTypes, UnwrapReturn } from "./types";
import { typedExpr } from "./types";

type DescriptorInput = TSTypeDescriptor | TypeRef<unknown> | string | undefined;

const isUnknownish = (type?: TSTypeDescriptor): boolean => {
  if (!type) return true;
  if (type.kind === "primitive") return type.name === "unknown";
  if (type.kind === "array") return isUnknownish(type.elementType);
  if (type.kind === "object") return Object.values(type.properties).every(prop => {
    const desc = (prop as any)?.type ? (prop as any).type as TSTypeDescriptor : prop as TSTypeDescriptor;
    return isUnknownish(desc);
  });
  if (type.kind === "union" || type.kind === "intersection") return type.types.every(isUnknownish);
  if (type.kind === "tuple") return type.types.every(el => {
    const desc = (el as any)?.type ? (el as any).type as TSTypeDescriptor : el as TSTypeDescriptor;
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

  const tsType =
    p.tsType instanceof TypeRef ? p.tsType.toDescriptor()
    : p.tsType;

  const normalizedType: TSTypeDescriptor | undefined = p.rest ?
    (tsType && (tsType.kind === "array" || tsType.kind === "tuple")
      ? tsType
      : { kind: "array", elementType: tsType ?? types.unknown() })
    : tsType;

  const defaultValue = p.default === undefined ? undefined : normalizeToExpression(p.default);

  return {
    name: p.name,
    tsType: normalizedType,
    optional: p.optional,
    rest: p.rest,
    default: defaultValue
  };
};

const toExpr = (value: unknown): Expression => normalizeToExpression(value);

const toExprList = (values: readonly unknown[]): Expression[] =>
  values.map(value => normalizeToExpression(value));

const toTypeDesc = (type: DescriptorInput): TSTypeDescriptor | undefined => {
  if (type === undefined) return undefined;
  if (type instanceof TypeRef) return type.toDescriptor();
  if (typeof type === "string") return parseTypeString(type);
  return type;
};

type AnnotationToType<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

type MethodReturn<ROpt, R> =
  ROpt extends TypeRef<infer U> ? U
  : ROpt extends TSTypeDescriptor ? InferTSType<ROpt>
  : UnwrapReturn<R>;

type InstanceShape<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

type ImplementsInput = TSTypeDescriptor | TypeRef<unknown> | readonly (TSTypeDescriptor | TypeRef<unknown>)[];
type InferImplements<I> =
  I extends readonly (infer E)[] ? InstanceShape<E>
  : InstanceShape<I>;

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
  tsType?: TSTypeDescriptor | TypeRef<unknown>;
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
};

type ArrowParamToType<P> =
  P extends { tsType?: infer T }
    ? T extends TypeRef<infer U> ? U
      : T extends TSTypeDescriptor ? InferTSType<T>
      : unknown
    : unknown;

type ArrowParamsToTuple<Ps extends readonly ArrowParamInput[]> =
  Ps extends readonly [] ? []
  : Ps extends readonly [infer H, ...infer T]
    ? H extends ArrowParamInput
      ? H["rest"] extends true ? Array<ArrowParamToType<H>>
        : H["optional"] extends true ? [ArrowParamToType<H> | undefined, ...ArrowParamsToTuple<T extends readonly ArrowParamInput[] ? T : []>]
        : [ArrowParamToType<H>, ...ArrowParamsToTuple<T extends readonly ArrowParamInput[] ? T : []>]
      : []
  : [];

const normalizeClassParamInput = (value: ClassParamInput): {
  type: TSTypeDescriptor | TypeRef<any>;
  optional?: boolean;
  rest?: boolean;
  default?: unknown;
} => {
  if (value && typeof value === "object" && "type" in (value as any)) {
    const v = value as { type: TSTypeDescriptor | TypeRef<any>; optional?: boolean; rest?: boolean; default?: unknown };
    return { type: v.type, optional: v.optional, rest: v.rest, default: v.default };
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
      default: p.default
    })
  );

const normalizeClassMethodParams = (params: Record<string, ClassParamInput>): Param[] =>
  Object.entries(params).map(([name, value]) => {
    const paramSource = normalizeClassParamInput(value);
    return normalizeParam({
      name,
      tsType: toTypeDesc(paramSource.type),
      optional: paramSource.optional,
      rest: paramSource.rest,
      default: paramSource.default
    });
  });

const createParamBindings = (
  paramArray: readonly Param[]
): {
  ctx: { variables: Map<string, TSTypeDescriptor> };
  argsByName: Record<string, VarRef<unknown>>;
} => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
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
  ctx: { variables: Map<string, TSTypeDescriptor> }
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
      if (shouldReplace) stmt.tsType = inferred;
      ctx.variables.set(stmt.name, resolveDescriptor(stmt.tsType));
    }
    bodyStatements.push(stmt);
    result = generator.next();
  }

  if (result.value !== undefined) {
    bodyStatements.push({
      type: "return",
      value: toExpr(result.value)
    });
  }

  return {
    bodyStatements,
    inferredReturnType: inferStatementsReturnType(bodyStatements, ctx)
  };
};

const finalizeReturnType = (
  provided?: TSTypeDescriptor,
  inferred?: TSTypeDescriptor
): TSTypeDescriptor | undefined =>
  provided && !isUnknownish(provided)
    ? provided
    : inferred ?? provided;

const buildFunctionTsType = (
  paramArray: readonly Param[],
  returnType?: TSTypeDescriptor
): TSTypeDescriptor => ({
  kind: "function",
  params: paramArray.map(param => param.tsType ?? types.unknown()),
  returnType: returnType ?? types.unknown()
});

type ClassInstanceType<InstanceAnnot, Implements> =
  InstanceAnnot extends TSTypeDescriptor | TypeRef<unknown>
    ? InstanceShape<InstanceAnnot>
    : Implements extends ImplementsInput
      ? InferImplements<Implements>
      : unknown;

type NumberLike = number | VarRef<number> | TypedExpression<number>;
type BooleanLike = boolean | VarRef<boolean> | TypedExpression<boolean>;
type ComparableInput<T> = VarRef<T> | TypedExpression<T> | T;

type EnumNamesFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> =
  Members[number] extends infer M
    ? M extends { id: infer I } ? I
      : M extends string ? M
      : never
    : never;

type EnumValueFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> =
  Members[number] extends infer M
    ? M extends { initializer: infer I }
      ? I extends string | number | boolean ? I : number
      : number
    : number;

type EnumShapeFrom<Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>> = {
  [K in EnumNamesFrom<Members> & string]: EnumValueFrom<Members>;
};

type BindingInput =
  | unknown
  | {
      value: unknown;
      tsType?: TSTypeDescriptor | TypeRef<unknown>;
      kind?: "let" | "const";
    };

type BindingValue<T> = T extends { value: infer V } ? V : T;

export const $ = {
  string: (value: string): StringExpr => brand({ type: "literal", value }),
  number: (value: number): NumberExpr => brand({ type: "literal", value }),
  bool: (value: boolean): BoolExpr => brand({ type: "literal", value }),

  array: <const T extends readonly any[]>(elements: T): TypedExpression<InferValueType<T[number]>[]> => {
    const expr: Expression = brand({
      type: "array",
      elements: toExprList(elements) as Expression[]
    });
    return typedExpr<InferValueType<T[number]>[]>(expr);
  },

  *let<const V>(
    name: string,
    value: V,
    tsType?: TSTypeDescriptor | TypeRef<unknown>
  ): Generator<Statement, VarRef<InferValueType<V>>, any> {
    const expr = normalizeToExpression(value);
    const descriptor =
      tsType instanceof TypeRef ? tsType.toDescriptor()
      : tsType ?? inferExpressionType(expr);
    const stmt: Statement = {
      type: "let",
      name,
      value: expr,
      tsType: descriptor
    };
    yield stmt;
    return new VarRef<InferValueType<V>>(name, descriptor);
  },

  *const<const V>(
    name: string,
    value: V,
    tsType?: TSTypeDescriptor | TypeRef<unknown>
  ): Generator<Statement, VarRef<InferValueType<V>>, any> {
    const expr = normalizeToExpression(value);
    const descriptor =
      tsType instanceof TypeRef ? tsType.toDescriptor()
      : tsType ?? inferExpressionType(expr);
    const stmt: Statement = {
      type: "const",
      name,
      value: expr,
      tsType: descriptor
    };
    yield stmt;
    return new VarRef<InferValueType<V>>(name, descriptor);
  },

  bind: (() => {
    const core = function* <const T extends Record<string, BindingInput>>(
      bindings: T,
      defaultKind: "let" | "const" = "const"
    ): Generator<Statement, { [K in keyof T]: VarRef<InferValueType<BindingValue<T[K]>>> }, any> {
      const result: Record<string, VarRef<unknown>> = {};

      for (const [key, raw] of Object.entries(bindings)) {
        const normalized =
          raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
            ? raw as { value: unknown; tsType?: TSTypeDescriptor | TypeRef<unknown>; kind?: "let" | "const" }
            : { value: raw } as { value: unknown; tsType?: TSTypeDescriptor | TypeRef<unknown>; kind?: "let" | "const" };

        const kind = normalized.kind ?? defaultKind;
        const expr = normalizeToExpression(normalized.value);
        const descriptor =
          normalized.tsType instanceof TypeRef ? normalized.tsType.toDescriptor()
          : normalized.tsType ?? inferExpressionType(expr);

        const stmt: Statement = {
          type: kind,
          name: key,
          value: expr,
          tsType: descriptor
        };

        yield stmt;
        result[key] = new VarRef(key, descriptor);
      }

      return result as { [K in keyof T]: VarRef<InferValueType<BindingValue<T[K]>>> };
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
    obj: T
  ): TypedExpression<{
    [K in keyof T]: InferValueType<T[K]>;
  }> => {
    const properties: Record<string, Expression> = {};
    for (const [key, value] of Object.entries(obj)) {
      properties[key] = toExpr(value);
    }
    const expr: Expression = brand({ type: "object", properties });
    return typedExpr<{ [K in keyof T]: InferValueType<T[K]> }>(expr);
  },

  prop: <
    T extends VarRef<unknown> | TypedExpression<unknown> | Expression,
    K extends string
  >(
    obj: T,
    key: K
  ): TypedExpression<
    T extends Expression
      ? unknown
      : K extends keyof UnwrapRef<T>
        ? UnwrapRef<T>[K]
        : unknown
  > => {
    const expr: Expression = brand({
      type: "member",
      object: obj instanceof VarRef ? brand({ type: "variable", name: obj.name }) : obj as Expression,
      property: String(key)
    });
    return typedExpr<
      T extends Expression
        ? unknown
        : K extends keyof UnwrapRef<T>
          ? UnwrapRef<T>[K]
          : unknown
    >(expr);
  },

  methodCall: <
    TObj,
    TMethod extends keyof TObj
  >(
    obj: VarRef<TObj> | TypedExpression<TObj>,
    method: TMethod,
    args: TObj[TMethod] extends (...a: infer A) => unknown ? A : never[]
  ): TypedExpression<TObj[TMethod] extends (...a: unknown[]) => infer R ? R : never> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: obj instanceof VarRef ? brand({ type: "variable", name: obj.name }) : obj,
        property: String(method)
      }),
      args: toExprList(args as unknown[])
    });
    return typedExpr<TObj[TMethod] extends (...a: unknown[]) => infer R ? R : never>(expr);
  },

  template: (parts: TemplateStringsArray | string[], ...expressions: unknown[]): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "template",
      parts: Array.from(parts),
      expressions: expressions.map(expr => normalizeToExpression(expr))
    });
    return typedExpr<string>(expr);
  },

  await: <T>(promise: VarRef<Promise<T>> | TypedExpression<Promise<T>>): TypedExpression<T> => {
    const expr: Expression = brand({
      type: "await",
      argument: promise instanceof VarRef ? brand({ type: "variable", name: promise.name }) : promise
    });
    return typedExpr<T>(expr);
  },

  not: (operand: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "!",
      operand: toExpr(operand)
    });
    return typedExpr<boolean>(expr);
  },

  typeof: (operand: unknown): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "typeof",
      operand: toExpr(operand)
    });
    return typedExpr<string>(expr);
  },

  ternary: <C, A>(test: unknown, consequent: C, alternate: A): TypedExpression<InferValueType<C> | InferValueType<A>> => {
    const expr: Expression = brand({
      type: "conditional",
      test: toExpr(test),
      consequent: toExpr(consequent),
      alternate: toExpr(alternate)
    });
    return typedExpr<InferValueType<C> | InferValueType<A>>(expr);
  },

  spread: <T extends readonly unknown[]>(argument: VarRef<T> | TypedExpression<T> | T): TypedExpression<T[number]> => {
    const expr: Expression = brand({
      type: "spread",
      argument:
        argument instanceof VarRef ? brand({ type: "variable", name: argument.name })
        : argument as Expression
    });
    return typedExpr<T[number]>(expr);
  },

  nullish: <L, R>(left: L, right: R): TypedExpression<NonNullable<InferValueType<L>> | InferValueType<R>> => {
    const expr: Expression = brand({
      type: "nullish",
      left: toExpr(left),
      right: toExpr(right)
    });
    return typedExpr<NonNullable<InferValueType<L>> | InferValueType<R>>(expr);
  },

  new: <
    C extends ClassRef<any, any> | VarRef<any> | TypedExpression<any> | string,
    TArgs extends Array<TSTypeDescriptor | TypeRef<unknown>> | undefined = undefined
  >(
    callee: C,
    args: C extends ClassRef<any, infer Ctor> ? Parameters<Ctor>
      : C extends VarRef<infer Fn> ? Fn extends (...a: infer A) => any ? A : unknown[]
      : unknown[],
    typeArgs?: TArgs
  ): TypedExpression<
    C extends ClassRef<infer I, any> ? I
      : C extends VarRef<infer Fn> ? Fn extends (...a: any[]) => infer R ? R : unknown
      : unknown
  > => {
    const tsTypeArgs = typeArgs?.map(arg => toTypeDesc(arg) ?? types.unknown());
    const expr: Expression = brand({
      type: "new",
      callee:
        callee instanceof VarRef ? brand({ type: "variable", name: callee.name })
        : typeof callee === "string" ? brand({ type: "variable", name: callee })
        : callee as Expression,
      arguments: toExprList(args as unknown[]),
      typeArguments: tsTypeArgs
    });

    return typedExpr<
      C extends ClassRef<infer I, any> ? I
        : C extends VarRef<infer Fn> ? Fn extends (...a: any[]) => infer R ? R : unknown
        : unknown
    >(expr);
  },

  this: (): Expression => {
    return brand({ type: "this" });
  },

  call: (() => {
    type CallOverload = {
      <TFn extends (...args: any[]) => any>(
        callee: VarRef<TFn> | TypedExpression<TFn>,
        args: CallArgs<Parameters<TFn>>,
        typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
        returnType?: TypeInput
      ): TypedExpression<ReturnType<TFn>>;
      (
        callee: string,
        args: unknown[],
        typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
        returnType?: TypeInput
      ): TypedExpression<unknown>;
    };

    const callImpl = (
      callee: VarRef<any> | TypedExpression<any> | string,
      args: unknown[],
      typeArgs?: Array<TSTypeDescriptor | TypeRef<unknown>>,
      _returnType?: TypeInput
    ): TypedExpression<unknown> => {
      const tsTypeArgs = typeArgs?.map(arg => toTypeDesc(arg) ?? types.unknown());
      const expr: Expression = brand({
        type: "call",
        callee:
          callee instanceof VarRef ? brand({ type: "variable", name: callee.name })
          : typeof callee === "string" ? brand({ type: "variable", name: callee })
          : callee as Expression,
        args: toExprList(args),
        typeArguments: tsTypeArgs
      });

      return typedExpr<any>(expr) as any;
    };

    return callImpl as CallOverload;
  })(),

  optionalProp: <
    TObj extends VarRef<unknown> | TypedExpression<unknown>,
    K extends keyof NonNullable<ExtractObjType<TObj>>
  >(
    obj: TObj,
    key: K
  ): TypedExpression<NonNullable<ExtractObjType<TObj>>[K] | undefined> => {
    const expr: Expression = brand({
      type: "optional-member",
      object: obj instanceof VarRef ? brand({ type: "variable", name: obj.name }) : obj as Expression,
      property: String(key)
    });
    return typedExpr<NonNullable<ExtractObjType<TObj>>[K] | undefined>(expr);
  },

  optionalCall: <TFn>(
    callee: VarRef<TFn> | TypedExpression<TFn>,
    args: NonNullable<TFn> extends (...a: infer A) => unknown ? A : unknown[]
  ): TypedExpression<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined> => {
    const expr: Expression = brand({
      type: "optional-call",
      callee: callee instanceof VarRef ? brand({ type: "variable", name: callee.name }) : callee as Expression,
      arguments: toExprList(args as unknown[])
    });
    return typedExpr<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined>(expr);
  },

  as: <T extends TypeInput>(expr: unknown, typeAnnotation: T): TypedExpression<ExtractType<T>> => {
    const typeDesc = toTypeDesc(typeAnnotation) ?? types.unknown();
    const expression: Expression = brand({
      type: "as",
      expression: toExpr(expr),
      typeAnnotation: typeDesc
    });
    return typedExpr<ExtractType<T>>(expression);
  },

  satisfies: <TExpr, TAnnot extends TypeInput>(
    expr: TExpr & (InferValueType<TExpr> extends ExtractType<TAnnot> ? unknown : ["DoesNotSatisfy", ExtractType<TAnnot>, InferValueType<TExpr>]),
    typeAnnotation: TAnnot
  ): TypedExpression<InferValueType<TExpr>> => {
    const typeDesc = toTypeDesc(typeAnnotation) ?? types.unknown();
    const expression: Expression = brand({
      type: "satisfies",
      expression: toExpr(expr),
      typeAnnotation: typeDesc
    });
    return typedExpr<InferValueType<TExpr>>(expression);
  },

  nonNull: <T>(
    expr: VarRef<T> | TypedExpression<T>
  ): TypedExpression<NonNullable<T>> => {
    const expression: Expression = brand({
      type: "non-null",
      expression:
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : expr
    });
    return typedExpr<NonNullable<T>>(expression);
  },

  optional: {
    prop: <
      TObj extends VarRef<unknown> | TypedExpression<unknown>,
      K extends keyof NonNullable<ExtractObjType<TObj>>
    >(
      obj: TObj,
      key: K
    ): TypedExpression<NonNullable<ExtractObjType<TObj>>[K] | undefined> => {
      return $.optionalProp(obj, key);
    },

    call: <TFn>(
      callee: VarRef<TFn> | TypedExpression<TFn>,
      args: NonNullable<TFn> extends (...a: infer A) => unknown ? A : unknown[]
    ): TypedExpression<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined> => {
      return $.optionalCall(callee, args);
    }
  },

  *forOf<T, E = ExtractIterableElementType<T>>(
    variable: string,
    iterable: T,
    body: (loopVar: VarRef<E>) => Generator<Statement, any, any>
  ): Generator<Statement, void, any> {
    const iterableExpr = toExpr(iterable);

    const loopVar = new VarRef<E>(variable);
    const bodyStatements: Statement[] = [];

    for (const stmt of body(loopVar)) {
      bodyStatements.push(stmt);
    }

    const forStmt: Statement = {
      type: "for-of",
      variable,
      iterable: iterableExpr as Expression,
      body: bodyStatements
    };

    yield forStmt;
  },

  p: <N extends string, T extends TypeInput>(
    name: N,
    type: T,
    options?: { optional?: boolean; rest?: boolean; default?: unknown }
  ): ParamDef<N, T> => ({ name, type, optional: options?.optional, rest: options?.rest, default: options?.default }),

  function: (() => {
    return function*<Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      }
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
        typeParams: options?.typeParams
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => UnwrapReturn<R>>(
        name,
        buildFunctionTsType(paramArray, finalReturnType)
      );
    };
  })(),

  block: (bodyFn: () => Generator<Statement, any, any>) => {
    const statements: Statement[] = [];
    for (const stmt of bodyFn()) {
      statements.push(stmt);
    }

    return {
      toBabelAST: () => t.blockStatement(statements.map(statementToBabel))
    };
  },

  if: <T = void>(
    condition: unknown,
    then: () => Generator<Statement, T, any>,
    elseBlock?: () => Generator<Statement, T, any>
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
        else: elseStatements.length > 0 ? elseStatements : undefined
      };

      yield ifStmt;
      return elseBlock ? elseResult : thenResult.value;
    })();
  },

  return: <T>(value?: T): Statement => {
    return {
      type: "return",
      value: value === undefined ? undefined : normalizeToExpression(value)
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
    body: () => Generator<Statement, any, any>
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "while",
      test: toExpr(test),
      body: bodyStatements
    };
  },

  *doWhile(
    body: () => Generator<Statement, any, any>,
    test: unknown
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "do-while",
      body: bodyStatements,
      test: toExpr(test)
    };
  },

  *type<T extends TSTypeDescriptor>(
    name: string,
    definition: T,
    typeParams?: string[]
  ): Generator<Statement, TypeRef<InferTSType<T>>, any> {
    const stmt: Statement = {
      type: "type-alias",
      name,
      definition,
      typeParams
    };
    yield stmt;
    typeAliasRegistry.set(name, definition);
    return new TypeRef<InferTSType<T>>(name, { kind: "reference", name }, definition);
  },

  *interface<T extends Record<string, TSTypeDescriptor>>(
    name: string,
    properties: T,
    typeParams?: string[]
  ): Generator<Statement, TypeRef<{ [K in keyof T]: InferTSType<T[K]> }>, any> {
    const stmt: Statement = {
      type: "interface",
      name,
      properties,
      typeParams
    };
    yield stmt;
    const descriptor = type.object(properties);
    typeAliasRegistry.set(name, descriptor);
    return new TypeRef<{ [K in keyof T]: InferTSType<T[K]> }>(name, {
      kind: "reference",
      name
    }, descriptor);
  },

  arrow: <
    Body extends Expression | Statement[] | (() => Generator<Statement, any, any>),
    ParamsInput extends ReadonlyArray<{
      name: string;
      tsType?: TSTypeDescriptor | TypeRef<unknown>;
      optional?: boolean;
      rest?: boolean;
      default?: unknown;
    }>
  >(
    params: ParamsInput,
    body: Body,
    opts?: { async?: boolean; returnType?: TSTypeDescriptor | TypeRef<unknown> }
  ): TypedExpression<(...args: ArrowParamsToTuple<ParamsInput>) => Body extends Expression ? UnwrapReturn<Body> : unknown> => {
    const paramArray = params.map(p =>
      normalizeParam({
        name: p.name,
        tsType: toTypeDesc(p.tsType),
        optional: p.optional,
        rest: p.rest,
        default: p.default
      })
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
      returnType: toTypeDesc(opts?.returnType)
    });

    return typedExpr<(...args: ArrowParamsToTuple<ParamsInput>) => Body extends Expression ? UnwrapReturn<Body> : unknown>(expr);
  },

  update: (
    operator: "++" | "--",
    expr: any,
    prefix: boolean = false
  ): TypedExpression<number> => {
    const expression: Expression = brand({
      type: "update",
      operator,
      argument:
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : expr,
      prefix
    });
    return typedExpr<number>(expression);
  },

  taggedTemplate: <TTag extends (...args: unknown[]) => unknown>(
    tag: VarRef<TTag> | TypedExpression<TTag> | string,
    template: TemplateExpression | TypedExpression<string>
  ): TypedExpression<ReturnType<TTag>> => {
    const expr: Expression = brand({
      type: "tagged-template",
      tag:
        tag instanceof VarRef ? brand({ type: "variable", name: tag.name })
        : typeof tag === "string" ? brand({ type: "variable", name: tag })
        : tag as Expression,
      quasi: template as TemplateExpression
    });
    return typedExpr<ReturnType<TTag>>(expr);
  },

  assign: <TLeft>(
    left: VarRef<TLeft> | TypedExpression<TLeft>,
    right: unknown,
    op: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&&=" | "||=" | "??=" = "="
  ): TypedExpression<TLeft> => {
    const expr: Expression = brand({
      type: "assignment",
      operator: op,
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : left as Expression,
      right: toExpr(right)
    });
    return typedExpr<TLeft>(expr);
  },

  *assignProps(
    target: VarRef<unknown> | TypedExpression<unknown>,
    props: Record<string, unknown>
  ): Generator<Statement, void, any> {
    const targetExpr: Expression =
      target instanceof VarRef ? brand({ type: "variable", name: target.name })
      : target as Expression;

    for (const [prop, value] of Object.entries(props)) {
      const left: Expression = brand({
        type: "member",
        object: targetExpr,
        property: prop
      });
      const right = normalizeToExpression(value);
      const expr: Expression = brand({
        type: "assignment",
        operator: "=",
        left,
        right
      });
      yield { type: "expression", expr };
    }
  },

  *switch(
    discriminant: unknown,
    casesBuilder: () => Array<{ test: unknown; body: () => Generator<Statement, any, any> } | { default: true; body: () => Generator<Statement, any, any> }>
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
    }
  ): Generator<Statement, void, any> {
    const blockStatements: Statement[] = [];
    for (const stmt of block()) {
      blockStatements.push(stmt);
    }

    let handler: { param?: { name: string; type?: TSTypeDescriptor }; body: Statement[] } | undefined;
    if (options?.catch) {
      const catchBody: Statement[] = [];
      for (const stmt of options.catch.body()) {
        catchBody.push(stmt);
      }

      if (options.catch.param) {
        if (typeof options.catch.param === "string") {
          handler = {
            param: { name: options.catch.param },
            body: catchBody
          };
        } else {
          const typeDesc = toTypeDesc(options.catch.param.type);
          handler = {
            param: { name: options.catch.param.name, type: typeDesc },
            body: catchBody
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

  classProperty: <TAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined>(
    key: string,
    options?: TAnnot | {
      value?: unknown;
      typeAnnotation?: TAnnot;
      static?: boolean;
      readonly?: boolean;
      accessibility?: "public" | "private" | "protected";
    }
  ): ClassMember & {
    ref: VarRef<AnnotationToType<TAnnot>>;
    [Symbol.iterator]: () => Generator<ClassMember, VarRef<AnnotationToType<TAnnot>>, VarRef<unknown>>;
  } => {
    const normalized =
      options && typeof options === "object" && ("value" in options || "typeAnnotation" in options || "static" in options || "readonly" in options || "accessibility" in options)
        ? options as any
        : { typeAnnotation: options };

    const desc = toTypeDesc(normalized?.typeAnnotation);
    const ref = new VarRef<AnnotationToType<TAnnot>>(key, desc);

    const member: ClassMember & {
      ref: typeof ref;
      [Symbol.iterator]: () => Generator<ClassMember, typeof ref, VarRef<unknown>>;
    } = {
      type: "property",
      key,
      value:
        normalized && "value" in normalized
          ? normalizeToExpression(normalized.value)
          : undefined,
      typeAnnotation: toTypeDesc(normalized?.typeAnnotation),
      static: normalized?.static,
      readonly: normalized?.readonly,
      accessibility: normalized?.accessibility,
      ref,
      [Symbol.iterator]: function* () {
        const injected = yield member;
        return (injected as typeof ref | undefined) ?? ref;
      }
    };

    return member;
  },

  classMethod: <
    const ParamsSchema extends Record<string, ClassParamInput>,
    R = void,
    ReturnAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    ThisAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined
  >(
    key: string,
    params: ParamsSchema,
    body: (
      args: { [K in keyof ParamsSchema]: VarRef<ExtractType<ParamsSchema[K]>> },
      this_: VarRef<AnnotationToType<ThisAnnot>>
    ) => Generator<Statement, R, unknown>,
    options?: {
      kind?: "method" | "constructor" | "get" | "set";
      returnType?: ReturnAnnot;
      thisType?: ThisAnnot;
      static?: boolean;
      async?: boolean;
      accessibility?: "public" | "private" | "protected";
    }
  ): ClassMember & {
    ref: VarRef<(args: ParamSchemaToObjectArg<ParamsSchema>) => MethodReturn<ReturnAnnot, R>>;
    [Symbol.iterator]: () => Generator<ClassMember, VarRef<(args: ParamSchemaToObjectArg<ParamsSchema>) => MethodReturn<ReturnAnnot, R>>, VarRef<unknown>>;
  } => {
    const paramArray = normalizeClassMethodParams(params);
    const { ctx, argsByName } = createParamBindings(paramArray);
    const args = argsByName as { [K in keyof ParamsSchema]: VarRef<ExtractType<ParamsSchema[K]>> };

    const thisDesc = toTypeDesc(options?.thisType);
    const this_ = new VarRef<AnnotationToType<ThisAnnot>>("this", thisDesc);
    if (thisDesc) {
      ctx.variables.set("this", thisDesc);
    }

      const providedReturnType = toTypeDesc(options?.returnType);
    const { bodyStatements, inferredReturnType } = collectFunctionLikeBody(body(args, this_), ctx);
    const finalReturnType = finalizeReturnType(providedReturnType, inferredReturnType);

    const ref = new VarRef<(args: ParamSchemaToObjectArg<ParamsSchema>) => MethodReturn<ReturnAnnot, R>>(
      key,
      buildFunctionTsType(paramArray, finalReturnType)
    );

    const member: ClassMember & {
      ref: typeof ref;
      [Symbol.iterator]: () => Generator<ClassMember, typeof ref, VarRef<unknown>>;
    } = {
      type: "method",
      key,
      kind: options?.kind,
      params: paramArray,
      body: bodyStatements,
      returnType: finalReturnType,
      static: options?.static,
      async: options?.async,
      accessibility: options?.accessibility,
      ref,
      [Symbol.iterator]: function* () {
        const injected = yield member;
        return (injected as typeof ref | undefined) ?? ref;
      }
    };

    return member;
  },

  *class<
    Implements extends ImplementsInput | undefined = undefined,
    InstanceAnnot extends TSTypeDescriptor | TypeRef<unknown> | undefined = undefined,
    PublicReturn extends Record<string, VarRef<any>> | undefined = undefined
  >(
    name: string,
    options?:
      | {
          extends?: unknown;
          implements?: Implements;
          instanceType?: InstanceAnnot;
          typeParams?: TypeParameter[];
          body?: ClassMember[] | (() => ClassMember[] | Iterable<ClassMember> | Generator<ClassMember, any, VarRef<unknown>>);
        }
      | (() => Generator<ClassMember, PublicReturn, VarRef<unknown>>)
  ): Generator<
    Statement,
    ClassRef<
      PublicReturn extends Record<string, VarRef<any>>
        ? { [K in keyof PublicReturn]: PublicReturn[K] extends VarRef<infer T> ? T : unknown }
        : ClassInstanceType<InstanceAnnot, Implements>
    >,
    any
  > {
    const collectedProps: Record<string, TSTypeDescriptor> = {};
    const collectedMethods: Record<string, TSTypeDescriptor> = {};
    let synthesizedThis: TSTypeDescriptor | undefined;

    const bodyMembers: ClassMember[] = [];
    const bodyFactory = typeof options === "function" ? options : options?.body;
    const optionsObj =
      typeof options === "function"
        ? {} as {
            extends?: unknown;
            implements?: Implements;
            instanceType?: InstanceAnnot;
            typeParams?: TypeParameter[];
            body?: ClassMember[] | (() => ClassMember[] | Iterable<ClassMember> | Generator<ClassMember, any, VarRef<unknown>>);
          }
        : options ?? {};
    let publicReturn: Record<string, VarRef<any>> | undefined;

    if (bodyFactory) {
      const produced = typeof bodyFactory === "function" ? bodyFactory() : bodyFactory;
      if (Array.isArray(produced)) {
        bodyMembers.push(...produced);
      } else if (
        produced &&
        typeof (produced as Generator<ClassMember, any, VarRef<unknown> | undefined>).next === "function"
      ) {
        const iterator = produced as Generator<ClassMember, any, VarRef<unknown> | undefined>;
        let step = iterator.next();
        while (!step.done) {
          const member = step.value as ClassMember;
          bodyMembers.push(member);

          let injected: VarRef<unknown> | undefined;
          if (member.type === "property") {
            injected = new VarRef(member.key, member.typeAnnotation);
            if (member.typeAnnotation) {
              collectedProps[member.key] = member.typeAnnotation;
              synthesizedThis = synthesizedThis ?? { kind: "object", properties: {} };
              if (synthesizedThis.kind === "object") {
                synthesizedThis.properties[member.key] = member.typeAnnotation;
              }
            }
          } else if (member.type === "method") {
            const paramTypes = member.params.map(p => p.tsType ?? types.unknown());
            const returnType = member.returnType ?? types.unknown();
            const fnDesc: TSTypeDescriptor = {
              kind: "function",
              params: paramTypes,
              returnType
            };
            injected = new VarRef(member.key, fnDesc);
            collectedMethods[member.key] = fnDesc;
            if (synthesizedThis?.kind === "object") {
              synthesizedThis.properties[member.key] = fnDesc;
            }
          }

          step = iterator.next(injected);
        }
        publicReturn = step.value as Record<string, VarRef<any>> | undefined;
      } else if (produced && typeof (produced as Iterable<ClassMember>)[Symbol.iterator] === "function") {
        for (const member of produced as Iterable<ClassMember>) {
          bodyMembers.push(member);
        }
      }
    }

    const stmt: Statement = {
      type: "class",
      id: name,
      superClass: optionsObj.extends ?
        optionsObj.extends instanceof VarRef ? brand({ type: "variable", name: optionsObj.extends.name })
        : typeof optionsObj.extends === "string" ? brand({ type: "variable", name: optionsObj.extends })
        : optionsObj.extends as Expression
      : undefined,
      implements: (() => {
        const impls = optionsObj.implements;
        if (!impls) return undefined;
        const list = Array.isArray(impls) ? impls : [impls];
        return (list as any[]).map((v) => toTypeDesc(v as TSTypeDescriptor | TypeRef<unknown>) ?? types.unknown());
      })(),
      typeParameters: optionsObj.typeParams,
      body: bodyMembers
    };

    yield stmt;

    const implementsArray: any[] | undefined = optionsObj.implements
      ? Array.isArray(optionsObj.implements) ? optionsObj.implements as any[] : [optionsObj.implements]
      : undefined;
    const implementsDescriptors: TSTypeDescriptor[] | undefined = implementsArray
      ? implementsArray.map((impl) => toTypeDesc(impl as TSTypeDescriptor | TypeRef<unknown>) ?? types.unknown())
      : undefined;

    const publicDescriptor: TSTypeDescriptor | undefined = publicReturn
      ? {
          kind: "object",
          properties: Object.fromEntries(
            Object.entries(publicReturn).map(([k, v]) => {
              const tsType = (v as VarRef<any>).tsType;
              const desc = toTypeDesc(tsType as DescriptorInput) ?? types.unknown();
              return [k, desc];
            })
          )
        }
      : undefined;

    const instanceTsType: TSTypeDescriptor | undefined =
      optionsObj.instanceType ? toTypeDesc(optionsObj.instanceType)
      : { kind: "reference", name };

    if (instanceTsType) {
      classRegistry.set(name, instanceTsType);
    }

    type InstanceOut =
      PublicReturn extends Record<string, VarRef<any>>
        ? { [K in keyof PublicReturn]: PublicReturn[K] extends VarRef<infer T> ? T : unknown }
        : ClassInstanceType<InstanceAnnot, Implements>;

    return new ClassRef<InstanceOut>(name, instanceTsType);
  },

  *enum<
    const Members extends ReadonlyArray<string | { id: string; initializer?: unknown }>
  >(
    name: string,
    members: Members,
    options?: {
      const?: boolean;
    }
  ): Generator<Statement, VarRef<EnumShapeFrom<Members>>, any> {
    const enumMembers: EnumMember[] = members.map(member => {
      if (typeof member === "string") {
        return { id: member };
      } else {
        return {
          id: member.id,
          initializer:
            "initializer" in member
              ? normalizeToExpression(member.initializer)
              : undefined
        };
      }
    });

    const stmt: Statement = {
      type: "enum",
      id: name,
      members: enumMembers,
      const: options?.const
    };

    yield stmt;
    const literalInitializers =
      enumMembers.length > 0 &&
      enumMembers.every(m => m.initializer?.type === "literal");
    const enumDescriptor: TSTypeDescriptor = literalInitializers
      ? {
          kind: "union",
          types: enumMembers.map(m => types.literal((m.initializer as any).value as any))
        }
      : types.number();

    typeAliasRegistry.set(name, enumDescriptor);

    type EnumShape = EnumShapeFrom<Members>;

    return new VarRef<EnumShape>(name, enumDescriptor);
  },

  import: Object.assign(
    function* (
      specifiers: Array<{ imported: string; local?: string } | { default: string } | { namespace: string }>,
      source: string,
      typeOnly?: boolean
    ): Generator<Statement, void, any> {
      const importSpecifiers: any[] = specifiers.map(spec => {
        if ("default" in spec) {
          return { type: "default", local: spec.default };
        } else if ("namespace" in spec) {
          return { type: "namespace", local: spec.namespace };
        } else {
          return { type: "specifier", imported: spec.imported, local: spec.local };
        }
      });

      yield {
        type: "import",
        specifiers: importSpecifiers,
        source,
        typeOnly
      };
    },
    {
      default: function* (local: string, source: string): Generator<Statement, void, any> {
        yield {
          type: "import",
          specifiers: [{ type: "default", local }],
          source
        };
      },

      namespace: function* (local: string, source: string): Generator<Statement, void, any> {
        yield {
          type: "import",
          specifiers: [{ type: "namespace", local }],
          source
        };
      }
    }
  ),

  export: {
    named: function* (
      declarationOrSpecifiers: Statement | Array<{ local: string; exported?: string }>,
      source?: string,
      typeOnly?: boolean
    ): Generator<Statement, void, any> {
      if (Array.isArray(declarationOrSpecifiers)) {
        yield {
          type: "export-named",
          specifiers: declarationOrSpecifiers,
          source,
          typeOnly
        };
      } else {
        yield {
          type: "export-named",
          declaration: declarationOrSpecifiers,
          typeOnly
        };
      }
    },

    default: function* (declaration: Expression | Statement): Generator<Statement, void, any> {
      yield {
        type: "export-default",
        declaration
      };
    },

    all: function* (source: string, exported?: string): Generator<Statement, void, any> {
      yield {
        type: "export-all",
        source,
        exported
      };
    }
  },

  *namespace(
    name: string,
    bodyGenerator: () => Generator<Statement, any, any>
  ): Generator<Statement, void, any> {
    const bodyStatements: Statement[] = [];
    for (const stmt of bodyGenerator()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "namespace",
      id: name,
      body: bodyStatements
    };
  },

  *declare(statement: Statement): Generator<Statement, void, any> {
    yield {
      type: "declare",
      declaration: statement
    };
  },

  *expression(expr: unknown): Generator<Statement, void, any> {
    yield {
      type: "expression",
      expr: normalizeToExpression(expr)
    };
  },

  *raw(code: string): Generator<Statement, void, any> {
    yield { type: "raw-stmt", code };
  },

  async: (() => {
    return function*<Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      }
    ): Generator<Statement, VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>, any> {
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
        async: true
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>(
        name,
        buildFunctionTsType(paramArray, {
          kind: "generic",
          name: "Promise",
          args: [finalReturnType ?? types.unknown()]
        })
      );
    };
  })()
};

export const numeric = {
  add: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "+",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<number>(expr);
  },

  multiply: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "*",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<number>(expr);
  },

  subtract: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "-",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<number>(expr);
  },

  divide: (left: NumberLike, right: NumberLike): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "/",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<number>(expr);
  }
};

export const compare = {
  eq: <T>(left: ComparableInput<T>, right: ComparableInput<T>): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "string" ? brand({ type: "literal", value: left })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : typeof left === "boolean" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "===",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "string" ? brand({ type: "literal", value: right })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  neq: <T>(left: ComparableInput<T>, right: ComparableInput<T>): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "string" ? brand({ type: "literal", value: left })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : typeof left === "boolean" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "!==",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "string" ? brand({ type: "literal", value: right })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  lt: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "<",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  lte: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "<=",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  gt: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: ">",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  gte: (left: NumberLike, right: NumberLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: ">=",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  }
};

export const str = {
  concat: <L, R>(left: L, right: R): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "string" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "+",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "string" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<string>(expr);
  },

  length: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<number> => {
    const expr: Expression = brand({
      type: "member",
      object: str instanceof VarRef ? brand({ type: "variable", name: str.name }) : str,
      property: "length"
    });
    return typedExpr<number>(expr);
  },

  toUpperCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: str instanceof VarRef ? brand({ type: "variable", name: str.name }) : str,
        property: "toUpperCase"
      }),
      args: []
    });
    return typedExpr<string>(expr);
  },

  toLowerCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: str instanceof VarRef ? brand({ type: "variable", name: str.name }) : str,
        property: "toLowerCase"
      }),
      args: []
    });
    return typedExpr<string>(expr);
  },

  slice: <T>(
    str: VarRef<string> | TypedExpression<string>,
    start: number | VarRef<number>,
    end?: number | VarRef<number>
  ): TypedExpression<string> => {
    const args: Expression[] = [
      typeof start === "number" ?
        brand({ type: "literal", value: start })
      : brand({ type: "variable", name: start.name })
    ];

    if (end !== undefined) {
      args.push(
        typeof end === "number" ?
          brand({ type: "literal", value: end })
        : brand({ type: "variable", name: end.name })
      );
    }

    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: str instanceof VarRef ? brand({ type: "variable", name: str.name }) : str,
        property: "slice"
      }),
      args
    });
    return typedExpr<string>(expr);
  }
};

export const logic = {
  not: (operand: BooleanLike): TypedExpression<boolean> => $.not(operand),

  and: (left: BooleanLike, right: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "boolean" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "&&",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  },

  or: (left: BooleanLike, right: BooleanLike): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "binary",
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "boolean" ? brand({ type: "literal", value: left })
        : (left as Expression),
      op: "||",
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : (right as Expression)
    });
    return typedExpr<boolean>(expr);
  }
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
  infer: types.infer
};

export const createInterface = (
  name: string,
  properties: Record<string, TSTypeDescriptor>,
  typeParams?: string[]
) => {
  const props = Object.entries(properties).map(([key, type]) => {
    return t.tsPropertySignature(
      t.identifier(key),
      t.tsTypeAnnotation(typeDescriptorToTSType(type))
    );
  });

  const typeParameters = typeParams?.map(param => t.tsTypeParameter(null, null, param)) || null;

  return t.tsInterfaceDeclaration(
    t.identifier(name),
    typeParameters ? t.tsTypeParameterDeclaration(typeParameters) : null,
    null,
    t.tsInterfaceBody(props)
  );
};

export const createTypeAlias = (name: string, type: TSTypeDescriptor, typeParams?: string[]) => {
  const typeParameters = typeParams?.map(param => t.tsTypeParameter(null, null, param)) || null;

  return t.tsTypeAliasDeclaration(
    t.identifier(name),
    typeParameters ? t.tsTypeParameterDeclaration(typeParameters) : null,
    typeDescriptorToTSType(type)
  );
};
