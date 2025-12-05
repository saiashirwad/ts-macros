import * as t from "@babel/types";
import type { Expression, Statement, TSTypeDescriptor, TemplateExpression, ClassMember, Param, TypeParameter, EnumMember } from "./ir";
import { brand, isExpr } from "./ir";
import { VarRef, TypeRef, createTypedVarRef } from "./refs";
import { statementToBabel, generate, typeDescriptorToTSType } from "./babel";
import { types, normalizeToExpression, inferExpressionType, resolveDescriptor, typeAliasRegistry } from "./infer";
import type { TypedExpression, StringExpr, NumberExpr, BoolExpr, ArrayExpr, InferValueType, ExtractType, ExtractIterableElementType, InferTSType, UnwrapRef, ExtractObjType, ExtractFnType, CallArgs, ParamSchemaToObjectArg, TypeInput, ParamDef, ParamDefsToArgs, ParamDefsToTypes, UnwrapReturn } from "./types";
import { typedExpr } from "./types";

const isUnknownish = (type?: TSTypeDescriptor): boolean => {
  if (!type) return true;
  if (type.kind === "primitive") return type.name === "unknown";
  if (type.kind === "array") return isUnknownish(type.elementType);
  if (type.kind === "object") return Object.values(type.properties).every(isUnknownish);
  if (type.kind === "union" || type.kind === "intersection") return type.types.every(isUnknownish);
  if (type.kind === "tuple") return type.types.every(isUnknownish);
  return false;
};

type AnnotationToType<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : unknown;

type MethodReturn<ROpt, R> =
  ROpt extends TypeRef<infer U> ? U
  : ROpt extends TSTypeDescriptor ? InferTSType<ROpt>
  : UnwrapReturn<R>;

export const $ = {
  string: (value: string): StringExpr => brand({ type: "literal", value }),
  number: (value: number): NumberExpr => brand({ type: "literal", value }),
  bool: (value: boolean): BoolExpr => brand({ type: "literal", value }),

  array: <const T extends readonly any[]>(elements: T): ArrayExpr<T> => brand({
    type: "array",
    elements: elements.map(el =>
      typeof el === "string" ? brand({ type: "literal", value: el })
      : typeof el === "number" ? brand({ type: "literal", value: el })
      : typeof el === "boolean" ? brand({ type: "literal", value: el })
      : el
    ) as any
  }),

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

  object: <T extends Record<string, unknown>>(
    obj: T
  ): TypedExpression<{
    [K in keyof T]: InferValueType<T[K]>;
  }> => {
    const properties: Record<string, Expression> = {};
    for (const [key, value] of Object.entries(obj)) {
      properties[key] =
        value instanceof VarRef ? brand({ type: "variable", name: value.name })
        : typeof value === "string" ? brand({ type: "literal", value })
        : typeof value === "number" ? brand({ type: "literal", value })
        : typeof value === "boolean" ? brand({ type: "literal", value })
        : value && typeof value === "object" && "type" in value ? (value as Expression)
        : brand({ type: "literal", value: value as any });
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
      args: (args as unknown[]).map(arg =>
        arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
        : typeof arg === "string" ? brand({ type: "literal", value: arg })
        : typeof arg === "number" ? brand({ type: "literal", value: arg })
        : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
        : arg as Expression
      )
    });
    return typedExpr<TObj[TMethod] extends (...a: unknown[]) => infer R ? R : never>(expr);
  },

  template: (parts: TemplateStringsArray | string[], ...expressions: unknown[]): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "template",
      parts: Array.from(parts),
      expressions: expressions.map(expr =>
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : typeof expr === "string" ? brand({ type: "literal", value: expr })
        : typeof expr === "number" ? brand({ type: "literal", value: expr })
        : expr as Expression
      )
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

  not: (operand: unknown): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "!",
      operand:
        operand instanceof VarRef ? brand({ type: "variable", name: operand.name })
        : typeof operand === "boolean" ? brand({ type: "literal", value: operand })
        : operand as Expression
    });
    return typedExpr<boolean>(expr);
  },

  typeof: (operand: unknown): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "typeof",
      operand: operand instanceof VarRef ? brand({ type: "variable", name: operand.name }) : operand as Expression
    });
    return typedExpr<string>(expr);
  },

  ternary: <C, A>(test: unknown, consequent: C, alternate: A): TypedExpression<InferValueType<C> | InferValueType<A>> => {
    const expr: Expression = brand({
      type: "conditional",
      test:
        test instanceof VarRef ? brand({ type: "variable", name: test.name })
        : typeof test === "boolean" ? brand({ type: "literal", value: test })
        : test as Expression,
      consequent:
        consequent instanceof VarRef ? brand({ type: "variable", name: consequent.name })
        : typeof consequent === "string" ? brand({ type: "literal", value: consequent })
        : typeof consequent === "number" ? brand({ type: "literal", value: consequent })
        : typeof consequent === "boolean" ? brand({ type: "literal", value: consequent })
        : consequent as Expression,
      alternate:
        alternate instanceof VarRef ? brand({ type: "variable", name: alternate.name })
        : typeof alternate === "string" ? brand({ type: "literal", value: alternate })
        : typeof alternate === "number" ? brand({ type: "literal", value: alternate })
        : typeof alternate === "boolean" ? brand({ type: "literal", value: alternate })
        : alternate as Expression
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
      left:
        left instanceof VarRef ? brand({ type: "variable", name: left.name })
        : typeof left === "string" ? brand({ type: "literal", value: left })
        : typeof left === "number" ? brand({ type: "literal", value: left })
        : typeof left === "boolean" ? brand({ type: "literal", value: left })
        : left as Expression,
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "string" ? brand({ type: "literal", value: right })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : right as Expression
    });
    return typedExpr<NonNullable<InferValueType<L>> | InferValueType<R>>(expr);
  },

  new: <T = unknown>(
    callee: unknown,
    args: unknown[],
    typeArgs?: TSTypeDescriptor[]
  ): TypedExpression<T> => {
    const expr: Expression = brand({
      type: "new",
      callee:
        callee instanceof VarRef ? brand({ type: "variable", name: callee.name })
        : typeof callee === "string" ? brand({ type: "variable", name: callee })
        : callee as Expression,
      arguments: args.map(arg =>
        arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
        : typeof arg === "string" ? brand({ type: "literal", value: arg })
        : typeof arg === "number" ? brand({ type: "literal", value: arg })
        : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
        : arg as Expression
      ),
      typeArguments: typeArgs
    });
    return typedExpr<T>(expr);
  },

  this: (): Expression => {
    return brand({ type: "this" });
  },

  call: <TFn extends (...args: any[]) => any>(
    callee: VarRef<TFn> | TypedExpression<TFn> | string,
    args: TFn extends (...a: infer A) => any ? CallArgs<A> : unknown[]
  ): TypedExpression<TFn extends (...a: any[]) => infer R ? R : unknown> => {
    const expr: Expression = brand({
      type: "call",
      callee:
        callee instanceof VarRef ? brand({ type: "variable", name: callee.name })
        : typeof callee === "string" ? brand({ type: "variable", name: callee })
        : callee as Expression,
      args: (args as unknown[]).map(arg =>
        arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
        : typeof arg === "string" ? brand({ type: "literal", value: arg })
        : typeof arg === "number" ? brand({ type: "literal", value: arg })
        : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
        : arg as Expression
      )
    });
    return typedExpr<ReturnType<TFn>>(expr);
  },

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
      arguments: (args as unknown[]).map(arg =>
        arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
        : typeof arg === "string" ? brand({ type: "literal", value: arg })
        : typeof arg === "number" ? brand({ type: "literal", value: arg })
        : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
        : arg as Expression
      )
    });
    return typedExpr<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined>(expr);
  },

  as: <T extends TypeInput>(expr: unknown, typeAnnotation: T): TypedExpression<ExtractType<T>> => {
    const typeDesc = typeAnnotation instanceof TypeRef
      ? typeAnnotation.toDescriptor()
      : typeAnnotation as TSTypeDescriptor;
    const expression: Expression = brand({
      type: "as",
      expression:
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : typeof expr === "string" ? brand({ type: "literal", value: expr })
        : typeof expr === "number" ? brand({ type: "literal", value: expr })
        : typeof expr === "boolean" ? brand({ type: "literal", value: expr })
        : expr as Expression,
      typeAnnotation: typeDesc
    });
    return typedExpr<ExtractType<T>>(expression);
  },

  satisfies: <TExpr>(expr: TExpr, typeAnnotation: TSTypeDescriptor): TypedExpression<InferValueType<TExpr>> => {
    const expression: Expression = brand({
      type: "satisfies",
      expression:
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : typeof expr === "string" ? brand({ type: "literal", value: expr })
        : typeof expr === "number" ? brand({ type: "literal", value: expr })
        : typeof expr === "boolean" ? brand({ type: "literal", value: expr })
        : expr as Expression,
      typeAnnotation
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
      const expr: Expression = brand({
        type: "optional-member",
        object: obj instanceof VarRef ? brand({ type: "variable", name: obj.name }) : obj as Expression,
        property: String(key)
      });
      return typedExpr<NonNullable<ExtractObjType<TObj>>[K] | undefined>(expr);
    },

    call: <TFn>(
      callee: VarRef<TFn> | TypedExpression<TFn>,
      args: NonNullable<TFn> extends (...a: infer A) => unknown ? A : unknown[]
    ): TypedExpression<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined> => {
      const expr: Expression = brand({
        type: "optional-call",
        callee: callee instanceof VarRef ? brand({ type: "variable", name: callee.name }) : callee as Expression,
        arguments: (args as unknown[]).map(arg =>
          arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
          : typeof arg === "string" ? brand({ type: "literal", value: arg })
          : typeof arg === "number" ? brand({ type: "literal", value: arg })
          : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
          : arg as Expression
        )
      });
      return typedExpr<(NonNullable<TFn> extends (...a: unknown[]) => infer R ? R : unknown) | undefined>(expr);
    }
  },

  *forOf<T, E = ExtractIterableElementType<T>>(
    variable: string,
    iterable: T,
    body: (loopVar: VarRef<E>) => Generator<Statement, any, any>
  ): Generator<Statement, void, any> {
    const iterableExpr =
      iterable instanceof VarRef ? brand({ type: "variable", name: iterable.name } as Expression)
      : iterable && typeof iterable === "object" && "type" in iterable ?
        (iterable as any as Expression)
      : brand({ type: "literal", value: iterable as any });

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

  p: <N extends string, T extends TypeInput>(name: N, type: T): ParamDef<N, T> => ({ name, type }),

  function: (() => {
    const toDescriptor = (type: unknown): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type as TSTypeDescriptor;
    };

    return function*<Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      }
    ): Generator<Statement, VarRef<(...args: ParamDefsToTypes<Params>) => UnwrapReturn<R>>, any> {
      const paramArray = params.map(p => ({
        name: p.name,
        tsType: toDescriptor(p.type)
      }));

      const args = {} as ParamDefsToArgs<Params>;
      const ctx = { variables: new Map<string, TSTypeDescriptor>() };
      for (const p of params) {
        (args as Record<string, VarRef<unknown>>)[p.name] = new VarRef(p.name, toDescriptor(p.type));
        ctx.variables.set(p.name, toDescriptor(p.type));
      }

      const bodyStatements: Statement[] = [];
      const generator = body(args);
      let result = generator.next();
      let inferredReturnType: TSTypeDescriptor | undefined;

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
        const returnExpr =
          result.value instanceof VarRef ?
            brand({ type: "variable", name: result.value.name } as Expression)
          : typeof result.value === "string" ?
            brand({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "number" ?
            brand({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "boolean" ?
            brand({ type: "literal", value: result.value } as Expression)
          : (result.value as Expression);

        inferredReturnType = resolveDescriptor(inferExpressionType(returnExpr, ctx));

        bodyStatements.push({
          type: "return",
          value: returnExpr
        });
      }

      const providedReturnType = options?.returnType ? toDescriptor(options.returnType) : undefined;
      const finalReturnType =
        providedReturnType && !isUnknownish(providedReturnType)
          ? providedReturnType
          : inferredReturnType ?? providedReturnType;

      const funcStmt: Statement = {
        type: "function",
        name,
        params: paramArray,
        body: bodyStatements,
        returnType: finalReturnType
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => UnwrapReturn<R>>(
        name,
        finalReturnType
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
      const condExpr =
        condition instanceof VarRef ? brand({ type: "variable", name: condition.name } as Expression)
        : typeof condition === "boolean" ? brand({ type: "literal", value: condition } as Expression)
        : (condition as Expression);

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
      value:
        value === undefined ? undefined
        : value instanceof VarRef ? brand({ type: "variable", name: value.name })
        : typeof value === "string" ? brand({ type: "literal", value })
        : typeof value === "number" ? brand({ type: "literal", value })
        : typeof value === "boolean" ? brand({ type: "literal", value })
        : (value as Expression)
    };
  },

  *throw(argument: unknown): Generator<Statement, void, any> {
    const expr: Expression =
      argument instanceof VarRef ? brand({ type: "variable", name: argument.name })
      : typeof argument === "string" ? brand({ type: "literal", value: argument })
      : typeof argument === "number" ? brand({ type: "literal", value: argument })
      : typeof argument === "boolean" ? brand({ type: "literal", value: argument })
      : argument as Expression;

    yield { type: "throw", argument: expr };
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
    const testExpr: Expression =
      test instanceof VarRef ? brand({ type: "variable", name: test.name })
      : typeof test === "boolean" ? brand({ type: "literal", value: test })
      : test as Expression;

    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "while",
      test: testExpr,
      body: bodyStatements
    };
  },

  *doWhile(
    body: () => Generator<Statement, any, any>,
    test: unknown
  ): Generator<Statement, void, any> {
    const testExpr: Expression =
      test instanceof VarRef ? brand({ type: "variable", name: test.name })
      : typeof test === "boolean" ? brand({ type: "literal", value: test })
      : test as Expression;

    const bodyStatements: Statement[] = [];
    for (const stmt of body()) {
      bodyStatements.push(stmt);
    }

    yield {
      type: "do-while",
      body: bodyStatements,
      test: testExpr
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
    return new TypeRef<InferTSType<T>>(name, { kind: "reference", name });
  },

  *interface<T extends Record<string, TSTypeDescriptor>>(
    name: string,
    properties: T,
    typeParams?: string[]
  ): Generator<Statement, TypeRef<InferTSType<{ kind: "object"; properties: T }>>, any> {
    const stmt: Statement = {
      type: "interface",
      name,
      properties,
      typeParams
    };
    yield stmt;
    typeAliasRegistry.set(name, type.object(properties));
    return new TypeRef<InferTSType<{ kind: "object"; properties: T }>>(name, {
      kind: "reference",
      name
    });
  },

  arrow: <Body extends Expression | Statement[] | (() => Generator<Statement, any, any>)>(
    params: Array<{ name: string; tsType?: TSTypeDescriptor | TypeRef<unknown> }>,
    body: Body,
    opts?: { async?: boolean; returnType?: TSTypeDescriptor | TypeRef<unknown> }
  ): TypedExpression<(...args: unknown[]) => Body extends Expression ? UnwrapReturn<Body> : unknown> => {
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<unknown>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    const paramArray = params.map(p => ({
      name: p.name,
      tsType: p.tsType ? toDescriptor(p.tsType) : undefined
    }));

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
      returnType: opts?.returnType ? toDescriptor(opts.returnType) : undefined
    });

    return typedExpr<(...args: unknown[]) => Body extends Expression ? UnwrapReturn<Body> : unknown>(expr);
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
      right:
        right instanceof VarRef ? brand({ type: "variable", name: right.name })
        : typeof right === "string" ? brand({ type: "literal", value: right })
        : typeof right === "number" ? brand({ type: "literal", value: right })
        : typeof right === "boolean" ? brand({ type: "literal", value: right })
        : right as Expression
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
    const discriminantExpr: Expression =
      discriminant instanceof VarRef ? brand({ type: "variable", name: discriminant.name })
      : typeof discriminant === "string" ? brand({ type: "literal", value: discriminant })
      : typeof discriminant === "number" ? brand({ type: "literal", value: discriminant })
      : typeof discriminant === "boolean" ? brand({ type: "literal", value: discriminant })
      : discriminant as Expression;

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
        const testExpr: Expression =
          config.test instanceof VarRef ? brand({ type: "variable", name: config.test.name })
          : typeof config.test === "string" ? brand({ type: "literal", value: config.test })
          : typeof config.test === "number" ? brand({ type: "literal", value: config.test })
          : typeof config.test === "boolean" ? brand({ type: "literal", value: config.test })
          : config.test as Expression;

        const bodyStatements: Statement[] = [];
        for (const stmt of config.body()) {
          bodyStatements.push(stmt);
        }
        cases.push({ test: testExpr, consequent: bodyStatements });
      }
    }

    yield { type: "switch", discriminant: discriminantExpr, cases };
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
          const typeDesc =
            options.catch.param.type instanceof TypeRef ?
              options.catch.param.type.toDescriptor()
            : options.catch.param.type;
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
    options?: {
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
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<unknown>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    const desc: TSTypeDescriptor | undefined = options?.typeAnnotation
      ? options.typeAnnotation instanceof TypeRef ? options.typeAnnotation.toDescriptor() : options.typeAnnotation
      : undefined;
    const ref = new VarRef<AnnotationToType<TAnnot>>(key, desc);

    const member: ClassMember & {
      ref: typeof ref;
      [Symbol.iterator]: () => Generator<ClassMember, typeof ref, VarRef<unknown>>;
    } = {
      type: "property",
      key,
      value: options?.value ?
        options.value instanceof VarRef ? brand({ type: "variable", name: options.value.name })
        : typeof options.value === "string" ? brand({ type: "literal", value: options.value })
        : typeof options.value === "number" ? brand({ type: "literal", value: options.value })
        : typeof options.value === "boolean" ? brand({ type: "literal", value: options.value })
        : options.value as Expression
      : undefined,
      typeAnnotation: options?.typeAnnotation ? toDescriptor(options.typeAnnotation) : undefined,
      static: options?.static,
      readonly: options?.readonly,
      accessibility: options?.accessibility,
      ref,
      [Symbol.iterator]: function* () {
        const injected = yield member;
        return (injected as typeof ref | undefined) ?? ref;
      }
    };

    return member;
  },

  classMethod: <
    const ParamsSchema extends Record<string, TSTypeDescriptor | TypeRef<any>>,
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
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<unknown>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    const paramArray: Param[] = Object.entries(params).map(([name, type]) => ({
      name,
      tsType: toDescriptor(type)
    }));

    const args = {} as { [K in keyof ParamsSchema]: VarRef<ExtractType<ParamsSchema[K]>> };
    const ctx = { variables: new Map<string, TSTypeDescriptor>() };
    for (const [name, type] of Object.entries(params)) {
      const descriptor = toDescriptor(type);
      (args as Record<string, VarRef<unknown>>)[name] = new VarRef(name, descriptor);
      ctx.variables.set(name, descriptor);
    }

    const thisDesc: TSTypeDescriptor | undefined =
      options?.thisType instanceof TypeRef ? options.thisType.toDescriptor()
      : options?.thisType;
    const this_ = new VarRef<AnnotationToType<ThisAnnot>>("this", thisDesc);
    if (thisDesc) {
      ctx.variables.set("this", thisDesc);
    }

    const bodyStatements: Statement[] = [];
    const generator = body(args, this_);
    let result = generator.next();
    let inferredReturnType: TSTypeDescriptor | undefined;

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
      const returnExpr =
        result.value instanceof VarRef ?
          brand({ type: "variable", name: result.value.name } as Expression)
        : typeof result.value === "string" ?
          brand({ type: "literal", value: result.value } as Expression)
        : typeof result.value === "number" ?
          brand({ type: "literal", value: result.value } as Expression)
        : typeof result.value === "boolean" ?
          brand({ type: "literal", value: result.value } as Expression)
        : (result.value as Expression);

      inferredReturnType = resolveDescriptor(inferExpressionType(returnExpr, ctx));

      bodyStatements.push({
        type: "return",
        value: returnExpr
      });
    }

    const providedReturnType = options?.returnType ? toDescriptor(options.returnType) : undefined;
    const finalReturnType =
      providedReturnType && !isUnknownish(providedReturnType)
        ? providedReturnType
        : inferredReturnType ?? providedReturnType;

    const ref = new VarRef<(args: ParamSchemaToObjectArg<ParamsSchema>) => MethodReturn<ReturnAnnot, R>>(
      key,
      finalReturnType
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

  *class(
    name: string,
    options?: {
      extends?: unknown;
      implements?: (TSTypeDescriptor | TypeRef<unknown>)[];
      typeParams?: TypeParameter[];
      body?: ClassMember[] | (() => ClassMember[] | Iterable<ClassMember> | Generator<ClassMember, any, VarRef<unknown>>);
    }
  ): Generator<Statement, VarRef<unknown>, any> {
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<unknown>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    const collectedProps: Record<string, TSTypeDescriptor> = {};
    const collectedMethods: Record<string, TSTypeDescriptor> = {};
    let synthesizedThis: TSTypeDescriptor | undefined;

    const bodyMembers: ClassMember[] = [];
    if (options?.body) {
      const produced = typeof options.body === "function" ? options.body() : options.body;
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
      } else if (produced && typeof (produced as Iterable<ClassMember>)[Symbol.iterator] === "function") {
        for (const member of produced as Iterable<ClassMember>) {
          bodyMembers.push(member);
        }
      }
    }

    const stmt: Statement = {
      type: "class",
      id: name,
      superClass: options?.extends ?
        options.extends instanceof VarRef ? brand({ type: "variable", name: options.extends.name })
        : typeof options.extends === "string" ? brand({ type: "variable", name: options.extends })
        : options.extends as Expression
      : undefined,
      implements: options?.implements?.map(toDescriptor),
      typeParameters: options?.typeParams,
      body: bodyMembers
    };

    yield stmt;
    return new VarRef<unknown>(name);
  },

  *enum(
    name: string,
    members: Array<string | { id: string; initializer?: unknown }>,
    options?: {
      const?: boolean;
    }
  ): Generator<Statement, VarRef<unknown>, any> {
    const enumMembers: EnumMember[] = members.map(member => {
      if (typeof member === "string") {
        return { id: member };
      } else {
        return {
          id: member.id,
          initializer: member.initializer ?
            member.initializer instanceof VarRef ? brand({ type: "variable" as const, name: member.initializer.name })
            : typeof member.initializer === "string" ? brand({ type: "literal" as const, value: member.initializer })
            : typeof member.initializer === "number" ? brand({ type: "literal" as const, value: member.initializer })
            : typeof member.initializer === "boolean" ? brand({ type: "literal" as const, value: member.initializer })
            : member.initializer as Expression
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
    return new VarRef<unknown>(name);
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
    const toDescriptor = (type: unknown): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type as TSTypeDescriptor;
    };

    return function*<Params extends readonly ParamDef[], R>(
      name: string,
      params: [...Params],
      body: (args: ParamDefsToArgs<Params>) => Generator<Statement, R, any>,
      options?: {
        returnType?: TypeInput;
        typeParams?: string[];
      }
    ): Generator<Statement, VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>, any> {
      const paramArray = params.map(p => ({
        name: p.name,
        tsType: toDescriptor(p.type)
      }));

      const args = {} as ParamDefsToArgs<Params>;
      const ctx = { variables: new Map<string, TSTypeDescriptor>() };
      for (const p of params) {
        (args as Record<string, VarRef<unknown>>)[p.name] = new VarRef(p.name, toDescriptor(p.type));
        ctx.variables.set(p.name, toDescriptor(p.type));
      }

      const bodyStatements: Statement[] = [];
      const generator = body(args);
      let result = generator.next();
      let inferredReturnType: TSTypeDescriptor | undefined;

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
        const returnExpr =
          result.value instanceof VarRef ?
            brand({ type: "variable", name: result.value.name } as Expression)
          : typeof result.value === "string" ?
            brand({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "number" ?
            brand({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "boolean" ?
            brand({ type: "literal", value: result.value } as Expression)
          : (result.value as Expression);

        inferredReturnType = resolveDescriptor(inferExpressionType(returnExpr, ctx));

        bodyStatements.push({
          type: "return",
          value: returnExpr
        });
      }

      const providedReturnType = options?.returnType ? toDescriptor(options.returnType) : undefined;
      const finalReturnType =
        providedReturnType && !isUnknownish(providedReturnType)
          ? providedReturnType
          : inferredReturnType ?? providedReturnType;

      const funcStmt: Statement = {
        type: "function",
        name,
        params: paramArray,
        body: bodyStatements,
        returnType: finalReturnType,
        async: true
      };

      yield funcStmt;

      return new VarRef<(...args: ParamDefsToTypes<Params>) => Promise<UnwrapReturn<R>>>(
        name,
        finalReturnType
      );
    };
  })()
};

export const numeric = {
  add: <L, R>(left: L, right: R): TypedExpression<number> => {
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

  multiply: <L, R>(left: L, right: R): TypedExpression<number> => {
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

  subtract: <L, R>(left: L, right: R): TypedExpression<number> => {
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

  divide: <L, R>(left: L, right: R): TypedExpression<number> => {
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
  eq: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  neq: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  lt: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  lte: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  gt: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  gte: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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
  not: (operand: unknown): TypedExpression<boolean> => $.not(operand),

  and: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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

  or: <L, R>(left: L, right: R): TypedExpression<boolean> => {
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
  tuple: types.tuple
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
