// Expression types
export type LiteralExpression = {
  type: "literal";
  value: string | number | boolean;
};

export type VariableExpression = {
  type: "variable";
  name: string;
};

export type CallExpression = {
  type: "call";
  callee: Expression;
  args: Expression[];
};

export type MemberExpression = {
  type: "member";
  object: Expression;
  property: string;
};

export type BinaryExpression = {
  type: "binary";
  left: Expression;
  op: string;
  right: Expression;
};

export type ArrayExpression = {
  type: "array";
  elements: Expression[];
};

export type ObjectExpression = {
  type: "object";
  properties: Record<string, Expression>;
};

export type TemplateExpression = {
  type: "template";
  parts: string[];
  expressions: Expression[];
};

export type AwaitExpression = {
  type: "await";
  argument: Expression;
};

export type UnaryExpression = {
  type: "unary";
  operator: string;
  operand: Expression;
};

export type RawExpression = {
  type: "raw";
  code: string;
};

export type Expression =
  | LiteralExpression
  | VariableExpression
  | CallExpression
  | MemberExpression
  | BinaryExpression
  | ArrayExpression
  | ObjectExpression
  | TemplateExpression
  | AwaitExpression
  | UnaryExpression
  | RawExpression;

// Statement types
export type Param = { name: string; tsType?: TSTypeDescriptor };

export type RawStatement = {
  type: "raw-stmt";
  code: string;
};

export type Statement =
  | { type: "let"; name: string; value: Expression; tsType?: TSTypeDescriptor }
  | { type: "const"; name: string; value: Expression; tsType?: TSTypeDescriptor }
  | { type: "if"; condition: Expression; then: Statement[]; else?: Statement[] }
  | { type: "for-of"; variable: string; iterable: Expression; body: Statement[] }
  | { type: "for-in"; variable: string; iterable: Expression; body: Statement[] }
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
    }
  | RawStatement;

// TSTypeDescriptor types
export type TSTypeDescriptor =
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
  | { kind: "function"; params: TSTypeDescriptor[]; returnType: TSTypeDescriptor }
  | { kind: "object"; properties: Record<string, TSTypeDescriptor> }
  | { kind: "generic"; name: string; args: TSTypeDescriptor[] }
  | { kind: "reference"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "tuple"; types: TSTypeDescriptor[] };

// Expression branding
export const ExprBrand = Symbol("Expr");
export type Branded<T> = T & { [ExprBrand]: true };

export function brand<T>(expr: T): Branded<T> {
  return { ...expr, [ExprBrand]: true } as any;
}

export function isExpr(x: unknown): x is Expression {
  return !!x && typeof x === "object" && x !== null && ExprBrand in x;
}
