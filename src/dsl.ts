import * as t from "@babel/types";
import type { Expression, Statement, TSTypeDescriptor } from "./ir";
import { brand, isExpr } from "./ir";
import { VarRef, TypeRef, createTypedVarRef } from "./refs";
import { statementToBabel, generate, typeDescriptorToTSType } from "./babel";
import { types, normalizeToExpression, inferExpressionType, typeAliasRegistry } from "./infer";
import type { TypedExpression, StringExpr, NumberExpr, BoolExpr, ArrayExpr, InferValueType, ExtractType, ExtractIterableElementType, InferTSType } from "./types";
import { typedExpr } from "./types";

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
    tsType?: TSTypeDescriptor | TypeRef<any>
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
    tsType?: TSTypeDescriptor | TypeRef<any>
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

  object: <T extends Record<string, any>>(
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

  prop: <T extends VarRef<any>, K extends keyof (T extends VarRef<infer U> ? U : never)>(
    obj: T,
    prop: K
  ): TypedExpression<
    T extends VarRef<infer U> ?
      K extends keyof U ?
        U[K]
      : any
    : any
  > => {
    const expr: Expression = brand({
      type: "member",
      object: brand({ type: "variable", name: obj.name }),
      property: String(prop)
    });
    return typedExpr<
      T extends VarRef<infer U> ?
        K extends keyof U ?
          U[K]
        : any
      : any
    >(expr);
  },

  methodCall: <T = any>(obj: any, method: string, args: any[]): TypedExpression<T> => {
    const expr: Expression = brand({
      type: "call",
      callee: brand({
        type: "member",
        object: obj instanceof VarRef ? brand({ type: "variable", name: obj.name }) : obj,
        property: method
      }),
      args: args.map(arg =>
        arg instanceof VarRef ? brand({ type: "variable", name: arg.name })
        : typeof arg === "string" ? brand({ type: "literal", value: arg })
        : typeof arg === "number" ? brand({ type: "literal", value: arg })
        : typeof arg === "boolean" ? brand({ type: "literal", value: arg })
        : arg
      )
    });
    return typedExpr<T>(expr);
  },

  template: (parts: string[], ...expressions: any[]): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "template",
      parts,
      expressions: expressions.map(expr =>
        expr instanceof VarRef ? brand({ type: "variable", name: expr.name })
        : typeof expr === "string" ? brand({ type: "literal", value: expr })
        : typeof expr === "number" ? brand({ type: "literal", value: expr })
        : expr
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

  not: (operand: any): TypedExpression<boolean> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "!",
      operand:
        operand instanceof VarRef ? brand({ type: "variable", name: operand.name })
        : typeof operand === "boolean" ? brand({ type: "literal", value: operand })
        : operand
    });
    return typedExpr<boolean>(expr);
  },

  typeof: (operand: any): TypedExpression<string> => {
    const expr: Expression = brand({
      type: "unary",
      operator: "typeof",
      operand: operand instanceof VarRef ? brand({ type: "variable", name: operand.name }) : operand
    });
    return typedExpr<string>(expr);
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

  function: (() => {
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<any>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    return function* <
      const ParamsSchema extends Record<string, TSTypeDescriptor | TypeRef<any>>,
      R = any
    >(
      name: string,
      params: ParamsSchema,
      body: (args: {
        [K in keyof ParamsSchema]: VarRef<ExtractType<ParamsSchema[K]>>;
      }) => Generator<Statement, R, any>,
      options?: {
        returnType?: TSTypeDescriptor | TypeRef<any>;
        typeParams?: string[];
      }
    ): Generator<Statement, VarRef<(...args: any[]) => R>, any> {
      const paramArray = Object.entries(params).map(([key, type]) => ({
        name: key,
        tsType: toDescriptor(type)
      }));

      const normalizedParams = Object.entries(params).reduce(
        (acc, [key, type]) => {
          acc[key] = toDescriptor(type);
          return acc;
        },
        {} as Record<string, TSTypeDescriptor>
      );

      const args = {} as {
        [K in keyof ParamsSchema]: VarRef<ExtractType<ParamsSchema[K]>>;
      };
      for (const [key, typeDesc] of Object.entries(normalizedParams)) {
        // @ts-ignore
        args[key as keyof typeof normalizedParams] = createTypedVarRef(key, typeDesc) as any;
      }

      const bodyStatements: Statement[] = [];
      const generator = body(args);
      let result = generator.next();

      while (!result.done) {
        bodyStatements.push(result.value);
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

        bodyStatements.push({
          type: "return",
          value: returnExpr
        });
      }

      const funcStmt: Statement = {
        type: "function",
        name,
        params: paramArray,
        body: bodyStatements,
        returnType: options?.returnType ? toDescriptor(options.returnType) : undefined
      };

      yield funcStmt;

      return new VarRef<(...args: any[]) => R>(
        name,
        options?.returnType ? toDescriptor(options.returnType) : undefined
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
    condition: any,
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
        thenStatements.push(thenResult.value);
        thenResult = thenGen.next();
      }

      const elseStatements: Statement[] = [];
      let elseResult: any;
      if (elseBlock) {
        const elseGen = elseBlock();
        let elseGenResult = elseGen.next();
        while (!elseGenResult.done) {
          elseStatements.push(elseGenResult.value);
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
  }
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
