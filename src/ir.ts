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

export type ConditionalExpression = {
  type: "conditional";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
};

export type SpreadExpression = {
  type: "spread";
  argument: Expression;
};

export type NullishExpression = {
  type: "nullish";
  left: Expression;
  right: Expression;
};

export type NewExpression = {
  type: "new";
  callee: Expression;
  arguments: Expression[];
  typeArguments?: TSTypeDescriptor[];
};

export type ThisExpression = {
  type: "this";
};

export type OptionalMemberExpression = {
  type: "optional-member";
  object: Expression;
  property: string;
  computed?: boolean;
};

export type OptionalCallExpression = {
  type: "optional-call";
  callee: Expression;
  arguments: Expression[];
};

export type AsExpression = {
  type: "as";
  expression: Expression;
  typeAnnotation: TSTypeDescriptor;
};

export type SatisfiesExpression = {
  type: "satisfies";
  expression: Expression;
  typeAnnotation: TSTypeDescriptor;
};

export type NonNullExpression = {
  type: "non-null";
  expression: Expression;
};

export type ArrowExpression = {
  type: "arrow";
  params: Param[];
  body: Expression | Statement[];
  async?: boolean;
  returnType?: TSTypeDescriptor;
};

export type UpdateExpression = {
  type: "update";
  operator: "++" | "--";
  argument: Expression;
  prefix: boolean;
};

export type TaggedTemplateExpression = {
  type: "tagged-template";
  tag: Expression;
  quasi: TemplateExpression;
};

export type AssignmentExpression = {
  type: "assignment";
  operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&&=" | "||=" | "??=";
  left: Expression;
  right: Expression;
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
  | RawExpression
  | ConditionalExpression
  | SpreadExpression
  | NullishExpression
  | NewExpression
  | ThisExpression
  | OptionalMemberExpression
  | OptionalCallExpression
  | AsExpression
  | SatisfiesExpression
  | NonNullExpression
  | ArrowExpression
  | UpdateExpression
  | TaggedTemplateExpression
  | AssignmentExpression;

// Statement types
export type Param = { name: string; tsType?: TSTypeDescriptor };

export type FunctionParam = {
  type: TSTypeDescriptor;
  optional?: boolean;
  rest?: boolean;
};

export type TypeParameter = { name: string; constraint?: TSTypeDescriptor; default?: TSTypeDescriptor };

export type RawStatement = {
  type: "raw-stmt";
  code: string;
};

export type SwitchCase = {
  test: Expression | null;
  consequent: Statement[];
};

export type CatchClause = {
  param?: { name: string; type?: TSTypeDescriptor };
  body: Statement[];
};

export type ClassProperty = {
  type: "property";
  key: string;
  value?: Expression;
  typeAnnotation?: TSTypeDescriptor;
  static?: boolean;
  readonly?: boolean;
  accessibility?: "public" | "private" | "protected";
};

export type ClassMethod = {
  type: "method";
  key: string;
  kind?: "method" | "constructor" | "get" | "set";
  params: Param[];
  body: Statement[];
  returnType?: TSTypeDescriptor;
  static?: boolean;
  async?: boolean;
  accessibility?: "public" | "private" | "protected";
};

export type ClassMember = ClassProperty | ClassMethod;

export type EnumMember = {
  id: string;
  initializer?: Expression;
};

export type ImportSpecifier =
  | { type: "specifier"; imported: string; local?: string }
  | { type: "default"; local: string }
  | { type: "namespace"; local: string };

export type ExportSpecifier = { local: string; exported?: string };

export type Statement =
  | { type: "let"; name: string; value: Expression; tsType?: TSTypeDescriptor }
  | { type: "const"; name: string; value: Expression; tsType?: TSTypeDescriptor }
  | { type: "if"; condition: Expression; then: Statement[]; else?: Statement[] }
  | { type: "for-of"; variable: string; iterable: Expression; body: Statement[] }
  | { type: "for-in"; variable: string; iterable: Expression; body: Statement[] }
  | { type: "while"; test: Expression; body: Statement[] }
  | { type: "do-while"; body: Statement[]; test: Expression }
  | { type: "return"; value?: Expression }
  | { type: "throw"; argument: Expression }
  | { type: "break"; label?: string }
  | { type: "continue"; label?: string }
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
  | { type: "switch"; discriminant: Expression; cases: SwitchCase[] }
  | { type: "try"; block: Statement[]; handler?: CatchClause; finalizer?: Statement[] }
  | {
      type: "class";
      id: string;
      superClass?: Expression;
      implements?: TSTypeDescriptor[];
      typeParameters?: TypeParameter[];
      body: ClassMember[];
    }
  | {
      type: "enum";
      id: string;
      members: EnumMember[];
      const?: boolean;
    }
  | {
      type: "import";
      specifiers: ImportSpecifier[];
      source: string;
      typeOnly?: boolean;
    }
  | {
      type: "export-named";
      declaration?: Statement;
      specifiers?: ExportSpecifier[];
      source?: string;
      typeOnly?: boolean;
    }
  | {
      type: "export-default";
      declaration: Expression | Statement;
    }
  | {
      type: "export-all";
      source: string;
      exported?: string;
    }
  | {
      type: "namespace";
      id: string;
      body: Statement[];
    }
  | {
      type: "declare";
      declaration: Statement;
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
