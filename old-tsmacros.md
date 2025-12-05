```typescript
import { generate } from "@babel/generator";
import * as t from "@babel/types";
import { constrainedMemory } from "node:process";

type LiteralExpression = {
  type: "literal";
  value: string | number | boolean;
};
type VariableExpression = {
  type: "variable";
  name: string;
};
type CallExpression = {
  type: "call";
  callee: Expression;
  args: Expression[];
};
type MemberExpression = {
  type: "member";
  object: Expression;
  property: string;
};
type BinaryExpression = {
  type: "binary";
  left: Expression;
  op: string;
  right: Expression;
};
type ArrayExpression = {
  type: "array";
  elements: Expression[];
};
type ObjectExpression = {
  type: "object";
  properties: Record<string, Expression>;
};
type TemplateExpression = {
  type: "template";
  parts: string[];
  expressions: Expression[];
};
type AwaitExpression = {
  type: "await";
  argument: Expression;
};
type UnaryExpression = {
  type: "unary";
  operator: string;
  operand: Expression;
};

type Expression =
  | LiteralExpression
  | VariableExpression
  | CallExpression
  | MemberExpression
  | BinaryExpression
  | ArrayExpression
  | ObjectExpression
  | TemplateExpression
  | AwaitExpression
  | UnaryExpression;

type Statement =
  | { type: "let"; name: string; value: Expression; tsType?: TSTypeDescriptor }
  | {
      type: "const";
      name: string;
      value: Expression;
      tsType?: TSTypeDescriptor;
    }
  | { type: "if"; condition: Expression; then: Statement[]; else?: Statement[] }
  | {
      type: "for-of";
      variable: string;
      iterable: Expression;
      body: Statement[];
    }
  | {
      type: "for-in";
      variable: string;
      iterable: Expression;
      body: Statement[];
    }
  | { type: "return"; value?: Expression }
  | { type: "expression"; expr: Expression }
  | {
      type: "function";
      name?: string;
      params: Param[];
      body: Statement[];
      returnType?: TSTypeDescriptor;
    }
  | { type: "block"; body: Statement[] }
  | {
      type: "type-alias";
      name: string;
      definition: TSTypeDescriptor;
      typeParams?: string[];
    }
  | {
      type: "interface";
      name: string;
      properties: Record<string, TSTypeDescriptor>;
      typeParams?: string[];
    };

type Param = { name: string; tsType?: TSTypeDescriptor };

type TSTypeDescriptor =
  | {
      kind: "primitive";
      name:
        | "string"
        | "number"
        | "boolean"
        | "any"
        | "void"
        | "undefined"
        | "null"
        | "never"
        | "unknown";
    }
  | { kind: "array"; elementType: TSTypeDescriptor }
  | { kind: "union"; types: TSTypeDescriptor[] }
  | { kind: "intersection"; types: TSTypeDescriptor[] }
  | {
      kind: "function";
      params: TSTypeDescriptor[];
      returnType: TSTypeDescriptor;
    }
  | { kind: "object"; properties: Record<string, TSTypeDescriptor> }
  | { kind: "generic"; name: string; args: TSTypeDescriptor[] }
  | { kind: "reference"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "tuple"; types: TSTypeDescriptor[] };

export class TypeRef<T = any> {
  declare readonly __tag = "TypeRef";
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

function typeDescriptorToTSType(typeDesc: TSTypeDescriptor | TypeRef<any>): t.TSType {
  if (typeDesc instanceof TypeRef) {
    return t.tsTypeReference(t.identifier(typeDesc.name));
  }

  switch (typeDesc.kind) {
    case "primitive":
      switch (typeDesc.name) {
        case "string":
          return t.tsStringKeyword();
        case "number":
          return t.tsNumberKeyword();
        case "boolean":
          return t.tsBooleanKeyword();
        case "any":
          return t.tsAnyKeyword();
        case "void":
          return t.tsVoidKeyword();
        case "undefined":
          return t.tsUndefinedKeyword();
        case "null":
          return t.tsNullKeyword();
        case "never":
          return t.tsNeverKeyword();
        case "unknown":
          return t.tsUnknownKeyword();
      }
      break;

    case "array":
      return t.tsArrayType(typeDescriptorToTSType(typeDesc.elementType));

    case "union":
      return t.tsUnionType(typeDesc.types.map(typeDescriptorToTSType));

    case "intersection":
      return t.tsIntersectionType(typeDesc.types.map(typeDescriptorToTSType));

    case "function":
      const params = typeDesc.params.map((paramType, index) => {
        const param = t.identifier(`arg${index}`);
        param.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(paramType));
        return param;
      });
      const returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc.returnType));
      return t.tsFunctionType(null, params, returnType);

    case "object":
      return t.tsTypeLiteral(
        Object.entries(typeDesc.properties).map(([key, propType]) => {
          return t.tsPropertySignature(
            t.identifier(key),
            t.tsTypeAnnotation(typeDescriptorToTSType(propType))
          );
        })
      );

    case "generic":
      if (typeDesc.args.length === 0) {
        return t.tsTypeReference(t.identifier(typeDesc.name));
      }
      return t.tsTypeReference(
        t.identifier(typeDesc.name),
        t.tsTypeParameterInstantiation(typeDesc.args.map(typeDescriptorToTSType))
      );

    case "reference":
      return t.tsTypeReference(t.identifier(typeDesc.name));

    case "literal":
      if (typeof typeDesc.value === "string") {
        return t.tsLiteralType(t.stringLiteral(typeDesc.value));
      }
      if (typeof typeDesc.value === "number") {
        return t.tsLiteralType(t.numericLiteral(typeDesc.value));
      }
      return t.tsLiteralType(t.booleanLiteral(typeDesc.value));

    case "tuple":
      return t.tsTupleType(typeDesc.types.map(typeDescriptorToTSType));
  }
}

function parseTypeString(typeStr: string): TSTypeDescriptor {
  switch (typeStr) {
    case "string":
      return { kind: "primitive", name: "string" };
    case "number":
      return { kind: "primitive", name: "number" };
    case "boolean":
      return { kind: "primitive", name: "boolean" };
    case "any":
      return { kind: "primitive", name: "any" };
    case "void":
      return { kind: "primitive", name: "void" };
    default:
      if (typeStr.endsWith("[]")) {
        const elementType = parseTypeString(typeStr.slice(0, -2));
        return { kind: "array", elementType };
      }
      if (typeStr.includes(" | ")) {
        const unionTypes = typeStr.split(" | ").map(parseTypeString);
        return { kind: "union", types: unionTypes };
      }
      if (typeStr.includes(" & ")) {
        const intersectionTypes = typeStr.split(" & ").map(parseTypeString);
        return { kind: "intersection", types: intersectionTypes };
      }
      return { kind: "reference", name: typeStr };
  }
}

const types = {
  string: () => ({ kind: "primitive", name: "string" }) as const,

  number: () => ({ kind: "primitive", name: "number" }) as const,

  boolean: () => ({ kind: "primitive", name: "boolean" }) as const,

  any: () => ({ kind: "primitive" as const, name: "any" as const }),

  void: () => ({ kind: "primitive" as const, name: "void" as const }),

  undefined: () => ({ kind: "primitive" as const, name: "undefined" as const }),

  null: () => ({ kind: "primitive" as const, name: "null" as const }),

  never: () => ({ kind: "primitive" as const, name: "never" as const }),

  unknown: () => ({ kind: "primitive" as const, name: "unknown" as const }),

  array: <T extends TSTypeDescriptor>(elementType: T) => ({ kind: "array" as const, elementType }),

  union: <T extends TSTypeDescriptor[]>(...types: T) => ({ kind: "union" as const, types }),

  intersection: <T extends TSTypeDescriptor[]>(...types: T) => ({
    kind: "intersection" as const,
    types
  }),

  function: <P extends TSTypeDescriptor[], R extends TSTypeDescriptor>(
    params: P,
    returnType: R
  ) => ({ kind: "function" as const, params, returnType }),

  object: <P extends Record<string, TSTypeDescriptor>>(properties: P) => ({
    kind: "object" as const,
    properties
  }),

  generic: <A extends TSTypeDescriptor[]>(name: string, ...args: A) => ({
    kind: "generic" as const,
    name,
    args
  }),

  reference: (name: string) => ({
    kind: "reference" as const,
    name
  }),

  promise: <T extends TSTypeDescriptor>(innerType: T) => ({
    kind: "generic" as const,
    name: "Promise",
    args: [innerType]
  }),

  literal: (value: string | number | boolean) => ({
    kind: "literal" as const,
    value
  }),

  tuple: <T extends TSTypeDescriptor[]>(...types: T) => ({
    kind: "tuple" as const,
    types
  })
};

// TODO: check if we actually need this tbh
const typeAliasRegistry = new Map<string, TSTypeDescriptor>();

export class VarRef<T = any> {
  declare readonly __tag = "VarRef";
  declare readonly __type: T;

  constructor(
    public name: string,
    public tsType?: TSTypeDescriptor | string
  ) {}

  toBabel(): t.Identifier {
    const id = t.identifier(this.name);
    if (this.tsType) {
      const typeDesc = typeof this.tsType === "string" ? parseTypeString(this.tsType) : this.tsType;
      id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
    }
    return id;
  }

  toString(): string {
    return this.name;
  }
}

type ExtractType<T> =
  T extends TypeRef<infer U> ? U
  : T extends TSTypeDescriptor ? InferTSType<T>
  : any;

type InferType<T> =
  T extends { type: "literal"; value: infer V } ? V
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>[]
  : T extends VarRef<infer R> ? R
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

type InferValueType<V> =
  V extends string ? string
  : V extends number ? number
  : V extends boolean ? boolean
  : V extends VarRef<infer T> ? T
  : V extends TypedExpression<infer T> ? T
  : V extends Expression ? InferType<V>
  : V extends readonly (infer E)[] ? InferValueType<E>[]
  : V extends Record<string, any> ? { [K in keyof V]: InferValueType<V[K]> }
  : any;

type InferTSType<T> =
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

// type ParamType<T> =
//   T extends { kind: "primitive"; name: infer N } ?
//     N extends "string" ? string
//     : N extends "number" ? number
//     : N extends "boolean" ? boolean
//     : N extends "any" ? any
//     : never
//   : T extends { kind: "array" } ? any[]
//   : T extends { kind: "object" } ? Record<string, any>
//   : T extends { kind: "reference"; name: string } ? any
//   : any;

// type FunctionArgs<Schema extends Record<string, TSTypeDescriptor | TypeRef<any>>> = {
//   [K in keyof Schema]: Schema[K] extends TypeRef<infer T> ? VarRef<T>
//   : Schema[K] extends TSTypeDescriptor ? VarRef<InferTSType<Schema[K]>>
//   : VarRef<any>;
// };

type UnionToIntersection<U> = U;

type ExtractIterableElementType<T> =
  T extends VarRef<(infer U)[]> ? U
  : T extends { type: "array"; elements: Array<infer E> } ? InferType<E>
  : T extends ArrayExpr<infer Elements> ?
    Elements extends readonly any[] ?
      Elements[number] extends infer ElementType ?
        InferType<ElementType>
      : never
    : never
  : any;

type StringExpr = { type: "literal"; value: string };
type NumberExpr = { type: "literal"; value: number };
type BoolExpr = { type: "literal"; value: boolean };
type ArrayExpr<T extends readonly any[] = any[]> = {
  type: "array";
  elements: T;
};

// Typed expression wrapper that preserves type information
type TypedExpression<T> = Expression & { __phantom?: T };

// Helper to create typed expressions
function typedExpr<T>(expr: Expression): TypedExpression<T> {
  return expr as TypedExpression<T>;
}

// Helper to create typed VarRef based on TSTypeDescriptor
function createTypedVarRef<T extends TSTypeDescriptor>(
  name: string,
  typeDesc: T
): VarRef<InferTSType<T>> {
  return new VarRef(name, typeDesc) as VarRef<InferTSType<T>>;
}

// ===== CENTRALIZED BABEL AST GENERATION =====

function expressionToBabel(expr: Expression): t.Expression {
  switch (expr.type) {
    case "literal":
      return (
        typeof expr.value === "string" ? t.stringLiteral(expr.value)
        : typeof expr.value === "number" ? t.numericLiteral(expr.value)
        : t.booleanLiteral(expr.value)
      );

    case "variable":
      return t.identifier(expr.name);

    case "call":
      return t.callExpression(expressionToBabel(expr.callee), expr.args.map(expressionToBabel));

    case "member":
      return t.memberExpression(expressionToBabel(expr.object), t.identifier(expr.property));

    case "binary":
      // Logical operators need special handling
      if (expr.op === "&&" || expr.op === "||") {
        return t.logicalExpression(
          expr.op,
          expressionToBabel(expr.left),
          expressionToBabel(expr.right)
        );
      }
      return t.binaryExpression(
        expr.op as any,
        expressionToBabel(expr.left),
        expressionToBabel(expr.right)
      );

    case "array":
      return t.arrayExpression(expr.elements.map(expressionToBabel));

    case "object":
      return t.objectExpression(
        Object.entries(expr.properties).map(([key, value]) =>
          t.objectProperty(t.identifier(key), expressionToBabel(value))
        )
      );

    case "template":
      const quasis = expr.parts.map((part, i) =>
        t.templateElement({ raw: part, cooked: part }, i === expr.parts.length - 1)
      );
      return t.templateLiteral(quasis, expr.expressions.map(expressionToBabel));

    case "await":
      return t.awaitExpression(expressionToBabel(expr.argument));

    case "unary":
      return t.unaryExpression(expr.operator as any, expressionToBabel(expr.operand));
  }
}

function statementToBabel(stmt: Statement): t.Statement {
  switch (stmt.type) {
    case "let": {
      const declarator = t.variableDeclarator(
        t.identifier(stmt.name),
        expressionToBabel(stmt.value)
      );
      if (stmt.tsType) {
        const typeDesc =
          typeof stmt.tsType === "string" ? parseTypeString(stmt.tsType) : stmt.tsType;
        (declarator.id as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
          typeDescriptorToTSType(typeDesc)
        );
      }
      return t.variableDeclaration("let", [declarator]);
    }

    case "const": {
      const declarator = t.variableDeclarator(
        t.identifier(stmt.name),
        expressionToBabel(stmt.value)
      );
      if (stmt.tsType) {
        const typeDesc =
          typeof stmt.tsType === "string" ? parseTypeString(stmt.tsType) : stmt.tsType;
        (declarator.id as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
          typeDescriptorToTSType(typeDesc)
        );
      }
      return t.variableDeclaration("const", [declarator]);
    }

    case "if":
      return t.ifStatement(
        expressionToBabel(stmt.condition),
        t.blockStatement(stmt.then.map(statementToBabel)),
        stmt.else ? t.blockStatement(stmt.else.map(statementToBabel)) : null
      );

    case "for-of":
      return t.forOfStatement(
        t.variableDeclaration("const", [t.variableDeclarator(t.identifier(stmt.variable))]),
        expressionToBabel(stmt.iterable),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "for-in":
      return t.forInStatement(
        t.variableDeclaration("const", [t.variableDeclarator(t.identifier(stmt.variable))]),
        expressionToBabel(stmt.iterable),
        t.blockStatement(stmt.body.map(statementToBabel))
      );

    case "return":
      return t.returnStatement(stmt.value ? expressionToBabel(stmt.value) : null);

    case "expression":
      return t.expressionStatement(expressionToBabel(stmt.expr));

    case "function": {
      const params = stmt.params.map(p => {
        const id = t.identifier(p.name);
        if (p.tsType) {
          const typeDesc = typeof p.tsType === "string" ? parseTypeString(p.tsType) : p.tsType;
          id.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return id;
      });

      const body = t.blockStatement(stmt.body.map(statementToBabel));

      if (stmt.name) {
        const funcDecl = t.functionDeclaration(t.identifier(stmt.name), params, body);
        if (stmt.returnType) {
          const typeDesc =
            typeof stmt.returnType === "string" ?
              parseTypeString(stmt.returnType)
            : stmt.returnType;
          funcDecl.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return funcDecl;
      } else {
        const arrowFunc = t.arrowFunctionExpression(params, body);
        if (stmt.returnType) {
          const typeDesc =
            typeof stmt.returnType === "string" ?
              parseTypeString(stmt.returnType)
            : stmt.returnType;
          arrowFunc.returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc));
        }
        return t.expressionStatement(arrowFunc);
      }
    }

    case "block":
      return t.blockStatement(stmt.body.map(statementToBabel));

    case "type-alias": {
      const typeParameters =
        stmt.typeParams ?
          t.tsTypeParameterDeclaration(
            stmt.typeParams.map(param => t.tsTypeParameter(null, null, param))
          )
        : null;
      return t.tsTypeAliasDeclaration(
        t.identifier(stmt.name),
        typeParameters,
        typeDescriptorToTSType(stmt.definition)
      );
    }

    case "interface": {
      const props = Object.entries(stmt.properties).map(([key, type]) => {
        const tsType = type instanceof TypeRef ? type.toDescriptor() : type;
        return t.tsPropertySignature(
          t.identifier(key),
          t.tsTypeAnnotation(typeDescriptorToTSType(tsType))
        );
      });
      const typeParameters =
        stmt.typeParams ?
          t.tsTypeParameterDeclaration(
            stmt.typeParams.map(param => t.tsTypeParameter(null, null, param))
          )
        : null;
      return t.tsInterfaceDeclaration(
        t.identifier(stmt.name),
        typeParameters,
        null,
        t.tsInterfaceBody(props)
      );
    }
  }
}

// ===== EXPRESSION NORMALIZATION & TYPE INFERENCE =====

function normalizeToExpression(value: any): Expression {
  if (typeof value === "string") return { type: "literal", value };
  if (typeof value === "number") return { type: "literal", value };
  if (typeof value === "boolean") return { type: "literal", value };
  if (value && typeof value === "object" && value.type) {
    // If it's already an expression (including TypedExpression), return it
    // This preserves the phantom type information
    return value as Expression;
  }
  if (value instanceof VarRef) return { type: "variable", name: value.name };
  if (Array.isArray(value)) {
    return {
      type: "array",
      elements: value.map(v => normalizeToExpression(v))
    };
  }
  if (typeof value === "object" && value !== null) {
    const properties: Record<string, Expression> = {};
    for (const [key, val] of Object.entries(value)) {
      properties[key] = normalizeToExpression(val);
    }
    return { type: "object", properties };
  }
  throw new Error(`Cannot normalize value to expression: ${value}`);
}

function inferExpressionType(expr: Expression): TSTypeDescriptor {
  switch (expr.type) {
    case "literal":
      return (
        typeof expr.value === "string" ? types.string()
        : typeof expr.value === "number" ? types.number()
        : types.boolean()
      );
    case "array":
      if (expr.elements.length === 0) return types.array(types.any());
      const elementType = inferExpressionType(expr.elements[0]);
      return types.array(elementType);
    case "object":
      const properties: Record<string, TSTypeDescriptor> = {};
      for (const [key, value] of Object.entries(expr.properties)) {
        properties[key] = inferExpressionType(value);
      }
      return types.object(properties);
    case "binary":
      // For arithmetic operations, return number
      if (["+", "-", "*", "/", "%", "**"].includes(expr.op)) {
        return types.number();
      }
      // For comparison operations, return boolean
      if (["===", "!==", ">", "<", ">=", "<=", "==", "!="].includes(expr.op)) {
        return types.boolean();
      }
      // For logical operations, return boolean
      if (["&&", "||"].includes(expr.op)) {
        return types.boolean();
      }
      // For string concatenation with +, check operand types
      if (expr.op === "+") {
        const leftType = inferExpressionType(expr.left);
        if (leftType.kind === "primitive" && leftType.name === "string") {
          return types.string();
        }
      }
      return types.any();
    case "template":
      return types.string();
    case "call":
      // For now, we can't infer function return types without more context
      return types.any();
    case "member":
      // Would need property type information to infer properly
      return types.any();
    case "await":
      // Would need to unwrap Promise type
      return types.any();
    case "unary":
      if (expr.operator === "!") return types.boolean();
      if (expr.operator === "-" || expr.operator === "+") return types.number();
      return types.any();
    default:
      return types.any();
  }
}

// ===== DSL BUILDER (SAME INTERFACE, BETTER TYPES) =====

export const $ = {
  string: (value: string): StringExpr => ({ type: "literal", value }),
  number: (value: number): NumberExpr => ({ type: "literal", value }),
  bool: (value: boolean): BoolExpr => ({ type: "literal", value }),

  array: <const T extends readonly any[]>(elements: T): ArrayExpr<T> => ({
    type: "array",
    elements: elements.map(el =>
      typeof el === "string" ? { type: "literal", value: el }
      : typeof el === "number" ? { type: "literal", value: el }
      : typeof el === "boolean" ? { type: "literal", value: el }
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
        value instanceof VarRef ? { type: "variable", name: value.name }
        : typeof value === "string" ? { type: "literal", value }
        : typeof value === "number" ? { type: "literal", value }
        : typeof value === "boolean" ? { type: "literal", value }
        : value && typeof value === "object" && "type" in value ? (value as Expression)
        : { type: "literal", value: value as any };
    }
    const expr: Expression = { type: "object", properties };
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
    const expr: Expression = {
      type: "member",
      object: { type: "variable", name: obj.name },
      property: String(prop)
    };
    return typedExpr<
      T extends VarRef<infer U> ?
        K extends keyof U ?
          U[K]
        : any
      : any
    >(expr);
  },

  methodCall: <T = any>(obj: any, method: string, args: any[]): TypedExpression<T> => {
    const expr: Expression = {
      type: "call",
      callee: {
        type: "member",
        object: obj instanceof VarRef ? { type: "variable", name: obj.name } : obj,
        property: method
      },
      args: args.map(arg =>
        arg instanceof VarRef ? { type: "variable", name: arg.name }
        : typeof arg === "string" ? { type: "literal", value: arg }
        : typeof arg === "number" ? { type: "literal", value: arg }
        : typeof arg === "boolean" ? { type: "literal", value: arg }
        : arg
      )
    };
    return typedExpr<T>(expr);
  },

  template: (parts: string[], ...expressions: any[]): TypedExpression<string> => {
    const expr: Expression = {
      type: "template",
      parts,
      expressions: expressions.map(expr =>
        expr instanceof VarRef ? { type: "variable", name: expr.name }
        : typeof expr === "string" ? { type: "literal", value: expr }
        : typeof expr === "number" ? { type: "literal", value: expr }
        : expr
      )
    };
    return typedExpr<string>(expr);
  },

  await: <T>(promise: VarRef<Promise<T>> | TypedExpression<Promise<T>>): TypedExpression<T> => {
    const expr: Expression = {
      type: "await",
      argument: promise instanceof VarRef ? { type: "variable", name: promise.name } : promise
    };
    return typedExpr<T>(expr);
  },

  not: (operand: any): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "unary",
      operator: "!",
      operand:
        operand instanceof VarRef ? { type: "variable", name: operand.name }
        : typeof operand === "boolean" ? { type: "literal", value: operand }
        : operand
    };
    return typedExpr<boolean>(expr);
  },

  typeof: (operand: any): TypedExpression<string> => {
    const expr: Expression = {
      type: "unary",
      operator: "typeof",
      operand: operand instanceof VarRef ? { type: "variable", name: operand.name } : operand
    };
    return typedExpr<string>(expr);
  },

  *forOf<T, E = ExtractIterableElementType<T>>(
    variable: string,
    iterable: T,
    body: (loopVar: VarRef<E>) => Generator<Statement, any, any>
  ): Generator<Statement, void, any> {
    const iterableExpr =
      iterable instanceof VarRef ? ({ type: "variable", name: iterable.name } as Expression)
      : iterable && typeof iterable === "object" && "type" in iterable ?
        (iterable as any as Expression)
      : { type: "literal", value: iterable as any };

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
    // Helper to convert TypeRef to TSTypeDescriptor
    const toDescriptor = (type: TSTypeDescriptor | TypeRef<any>): TSTypeDescriptor => {
      return type instanceof TypeRef ? type.toDescriptor() : type;
    };

    // Return the actual function implementation
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
        // Create VarRef with proper type based on TSTypeDescriptor
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
            ({ type: "variable", name: result.value.name } as Expression)
          : typeof result.value === "string" ?
            ({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "number" ?
            ({ type: "literal", value: result.value } as Expression)
          : typeof result.value === "boolean" ?
            ({ type: "literal", value: result.value } as Expression)
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

      // Return a VarRef representing the function
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
        condition instanceof VarRef ? ({ type: "variable", name: condition.name } as Expression)
        : typeof condition === "boolean" ? ({ type: "literal", value: condition } as Expression)
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
        : value instanceof VarRef ? { type: "variable", name: value.name }
        : typeof value === "string" ? { type: "literal", value }
        : typeof value === "number" ? { type: "literal", value }
        : typeof value === "boolean" ? { type: "literal", value }
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
    // Register the type alias
    typeAliasRegistry.set(name, definition);
    // Return a TypeRef instance
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
    // Register the interface as a type
    typeAliasRegistry.set(name, type.object(properties));
    // Return a TypeRef instance
    return new TypeRef<InferTSType<{ kind: "object"; properties: T }>>(name, {
      kind: "reference",
      name
    });
  }
};

// ===== NUMERIC OPERATIONS =====

// Helper type to extract numeric type from input
type ExtractNumericType<T> =
  T extends VarRef<infer U> ?
    U extends number ?
      number
    : any
  : T extends number ? number
  : T extends TypedExpression<infer U> ?
    U extends number ?
      number
    : any
  : any;

export const numeric = {
  add: <L, R>(left: L, right: R): TypedExpression<number> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "+",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<number>(expr);
  },

  multiply: <L, R>(left: L, right: R): TypedExpression<number> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "*",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<number>(expr);
  },

  subtract: <L, R>(left: L, right: R): TypedExpression<number> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "-",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<number>(expr);
  },

  divide: <L, R>(left: L, right: R): TypedExpression<number> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "/",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<number>(expr);
  }
};

// ===== COMPARISON OPERATORS =====

export const compare = {
  eq: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "string" ? { type: "literal", value: left }
        : typeof left === "number" ? { type: "literal", value: left }
        : typeof left === "boolean" ? { type: "literal", value: left }
        : (left as Expression),
      op: "===",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "string" ? { type: "literal", value: right }
        : typeof right === "number" ? { type: "literal", value: right }
        : typeof right === "boolean" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  neq: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "string" ? { type: "literal", value: left }
        : typeof left === "number" ? { type: "literal", value: left }
        : typeof left === "boolean" ? { type: "literal", value: left }
        : (left as Expression),
      op: "!==",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "string" ? { type: "literal", value: right }
        : typeof right === "number" ? { type: "literal", value: right }
        : typeof right === "boolean" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  lt: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "<",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  lte: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: "<=",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  gt: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: ">",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  gte: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "number" ? { type: "literal", value: left }
        : (left as Expression),
      op: ">=",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "number" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  }
};

// ===== STRING OPERATIONS =====

// Helper type to extract string type from input
type ExtractStringType<T> =
  T extends VarRef<infer U> ?
    U extends string ?
      string
    : any
  : T extends string ? string
  : T extends TypedExpression<infer U> ?
    U extends string ?
      string
    : any
  : any;

export const str = {
  concat: <L, R>(left: L, right: R): TypedExpression<string> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "string" ? { type: "literal", value: left }
        : (left as Expression),
      op: "+",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "string" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<string>(expr);
  },

  length: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<number> => {
    const expr: Expression = {
      type: "member",
      object: str instanceof VarRef ? { type: "variable", name: str.name } : str,
      property: "length"
    };
    return typedExpr<number>(expr);
  },

  toUpperCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = {
      type: "call",
      callee: {
        type: "member",
        object: str instanceof VarRef ? { type: "variable", name: str.name } : str,
        property: "toUpperCase"
      },
      args: []
    };
    return typedExpr<string>(expr);
  },

  toLowerCase: <T>(str: VarRef<string> | TypedExpression<string>): TypedExpression<string> => {
    const expr: Expression = {
      type: "call",
      callee: {
        type: "member",
        object: str instanceof VarRef ? { type: "variable", name: str.name } : str,
        property: "toLowerCase"
      },
      args: []
    };
    return typedExpr<string>(expr);
  },

  slice: <T>(
    str: VarRef<string> | TypedExpression<string>,
    start: number | VarRef<number>,
    end?: number | VarRef<number>
  ): TypedExpression<string> => {
    const args: Expression[] = [
      typeof start === "number" ?
        { type: "literal", value: start }
      : { type: "variable", name: start.name }
    ];

    if (end !== undefined) {
      args.push(
        typeof end === "number" ?
          { type: "literal", value: end }
        : { type: "variable", name: end.name }
      );
    }

    const expr: Expression = {
      type: "call",
      callee: {
        type: "member",
        object: str instanceof VarRef ? { type: "variable", name: str.name } : str,
        property: "slice"
      },
      args
    };
    return typedExpr<string>(expr);
  }
};

// ===== LOGICAL OPERATORS =====

export const logic = {
  and: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "boolean" ? { type: "literal", value: left }
        : (left as Expression),
      op: "&&",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "boolean" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  },

  or: <L, R>(left: L, right: R): TypedExpression<boolean> => {
    const expr: Expression = {
      type: "binary",
      left:
        left instanceof VarRef ? { type: "variable", name: left.name }
        : typeof left === "boolean" ? { type: "literal", value: left }
        : (left as Expression),
      op: "||",
      right:
        right instanceof VarRef ? { type: "variable", name: right.name }
        : typeof right === "boolean" ? { type: "literal", value: right }
        : (right as Expression)
    };
    return typedExpr<boolean>(expr);
  }
};

// ===== TYPE HELPERS =====

export const type = {
  // Base types
  string: types.string,
  number: types.number,
  boolean: types.boolean,
  any: types.any,
  void: types.void,
  undefined: types.undefined,
  null: types.null,
  never: types.never,
  unknown: types.unknown,

  // Complex types
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

const someBlock = $.block(function* () {
  const PersonType = yield* $.type(
    "Person",
    type.object({
      name: type.string(),
      age: type.number(),
      params: type.union(
        type.undefined(),
        type.object({
          id: type.string()
        })
      )
    })
  );

  const something: string = "2es";

  const fn = yield* $.function(
    "fn",
    {
      x: type.number(),
      y: type.string(),
      person: PersonType
    },
    function* ({ x, y, person }) {
      if (something === "Hi") {
        const hi = yield* $.let("hi", 2);
      } else {
        const hi = yield* $.let("hi", "smile");
      }
      const personName = yield* $.let(
        "personName",
        str.concat("hi, ", $.prop(person, "name")),
        type.string()
      );
      const c = yield* $.let("c", 3);
      const e = yield* $.let("e", str.concat(y, " world"), type.string());
      return c;
    }
  );

  const processArray = yield* $.function(
    "processArray",
    {
      items: type.array(type.number()),
      flag: type.boolean()
    },
    function* ({ items, flag }) {
      yield* $.forOf("item", items, function* (item) {
        yield* $.let("doubled", numeric.multiply(item, 2));
      });

      yield* $.if(flag, function* () {
        const twoType = yield* $.type("two", type.literal(2));
        const a = yield* $.const("a", 2, twoType);
      });
    }
  );
}).toBabelAST();

const { code } = generate(someBlock);
```
