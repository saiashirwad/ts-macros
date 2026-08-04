// Expression types
export type LiteralExpression = {
  type: "literal"
  value: string | number | boolean | null
}

export type VariableExpression = {
  type: "variable"
  name: string
}

export type CallExpression = {
  type: "call"
  callee: Expression
  args: Expression[]
  typeArguments?: TSTypeDescriptor[] | undefined
}

export type MemberExpression = {
  type: "member"
  object: Expression
  property: string | Expression
  computed?: boolean | undefined
}

export type BinaryExpression = {
  type: "binary"
  left: Expression
  op: string
  right: Expression
}

export type ArrayExpression = {
  type: "array"
  elements: Expression[]
}

export type ObjectExpression = {
  type: "object"
  properties: Record<string, Expression>
}

export type TemplateExpression = {
  type: "template"
  parts: string[]
  expressions: Expression[]
}

export type AwaitExpression = {
  type: "await"
  argument: Expression
}

export type UnaryExpression = {
  type: "unary"
  operator: string
  operand: Expression
}

export type RawExpression = {
  type: "raw"
  code: string
}

export type ConditionalExpression = {
  type: "conditional"
  test: Expression
  consequent: Expression
  alternate: Expression
}

export type SpreadExpression = {
  type: "spread"
  argument: Expression
}

export type NullishExpression = {
  type: "nullish"
  left: Expression
  right: Expression
}

export type NewExpression = {
  type: "new"
  callee: Expression
  arguments: Expression[]
  typeArguments?: TSTypeDescriptor[] | undefined
}

export type ThisExpression = {
  type: "this"
}

export type UndefinedExpression = {
  type: "undefined"
}

export type OptionalMemberExpression = {
  type: "optional-member"
  object: Expression
  property: string | Expression
  computed?: boolean | undefined
}

export type OptionalCallExpression = {
  type: "optional-call"
  callee: Expression
  arguments: Expression[]
}

export type AsExpression = {
  type: "as"
  expression: Expression
  typeAnnotation: TSTypeDescriptor
}

export type SatisfiesExpression = {
  type: "satisfies"
  expression: Expression
  typeAnnotation: TSTypeDescriptor
}

export type NonNullExpression = {
  type: "non-null"
  expression: Expression
}

export type ArrowExpression = {
  type: "arrow"
  params: Param[]
  body: Expression | Statement[]
  async?: boolean | undefined
  returnType?: TSTypeDescriptor | undefined
}

export type UpdateExpression = {
  type: "update"
  operator: "++" | "--"
  argument: Expression
  prefix: boolean
}

export type TaggedTemplateExpression = {
  type: "tagged-template"
  tag: Expression
  quasi: TemplateExpression
}

export type AssignmentExpression = {
  type: "assignment"
  operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&&=" | "||=" | "??="
  left: Expression
  right: Expression
}

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
  | UndefinedExpression
  | OptionalMemberExpression
  | OptionalCallExpression
  | AsExpression
  | SatisfiesExpression
  | NonNullExpression
  | ArrowExpression
  | UpdateExpression
  | TaggedTemplateExpression
  | AssignmentExpression

// Statement types
export type Param = {
  name: string
  tsType?: TSTypeDescriptor | undefined
  optional?: boolean | undefined
  rest?: boolean | undefined
  default?: Expression | undefined
}

export type FunctionParam = {
  type: TSTypeDescriptor
  optional?: boolean | undefined
  rest?: boolean | undefined
}

export type TypeParameter = {
  name: string
  constraint?: TSTypeDescriptor | undefined
  default?: TSTypeDescriptor | undefined
}

export type RawStatement = {
  type: "raw-stmt"
  code: string
}

export type SwitchCase = {
  test: Expression | null
  consequent: Statement[]
}

export type CatchClause = {
  param?: { name: string; type?: TSTypeDescriptor | undefined } | undefined
  body: Statement[]
}

export type ClassProperty = {
  type: "property"
  key: string
  value?: Expression | undefined
  typeAnnotation?: TSTypeDescriptor | undefined
  static?: boolean | undefined
  readonly?: boolean | undefined
  accessibility?: "public" | "private" | "protected" | undefined
}

export type ClassMethod = {
  type: "method"
  key: string
  kind?: "method" | "constructor" | "get" | "set" | undefined
  params: Param[]
  body: Statement[]
  returnType?: TSTypeDescriptor | undefined
  static?: boolean | undefined
  async?: boolean | undefined
  accessibility?: "public" | "private" | "protected" | undefined
}

export type ClassMember = ClassProperty | ClassMethod

export type EnumMember = {
  id: string
  initializer?: Expression | undefined
}

export type ImportSpecifier =
  | { type: "specifier"; imported: string; local?: string | undefined }
  | { type: "default"; local: string }
  | { type: "namespace"; local: string }

export type ExportSpecifier = { local: string; exported?: string | undefined }

export type Statement =
  | { type: "let"; name: string; value: Expression; tsType?: TSTypeDescriptor | undefined }
  | {
      type: "const"
      name: string
      value: Expression
      tsType?: TSTypeDescriptor | undefined
    }
  | { type: "if"; condition: Expression; then: Statement[]; else?: Statement[] | undefined }
  | {
      type: "for-of"
      variable: string
      iterable: Expression
      body: Statement[]
    }
  | {
      type: "for-in"
      variable: string
      iterable: Expression
      body: Statement[]
    }
  | { type: "while"; test: Expression; body: Statement[] }
  | { type: "do-while"; body: Statement[]; test: Expression }
  | { type: "return"; value?: Expression | undefined }
  | { type: "throw"; argument: Expression }
  | { type: "break"; label?: string | undefined }
  | { type: "continue"; label?: string | undefined }
  | { type: "expression"; expr: Expression }
  | {
      type: "function"
      name?: string | undefined
      params: Param[]
      body: Statement[]
      returnType?: TSTypeDescriptor | undefined
      typeParams?: string[] | undefined
      async?: boolean | undefined
    }
  | { type: "block"; body: Statement[] }
  | {
      type: "type-alias"
      name: string
      definition: TSTypeDescriptor
      typeParams?: string[] | undefined
    }
  | {
      type: "interface"
      name: string
      properties: Record<string, TSTypeDescriptor>
      typeParams?: string[] | undefined
    }
  | { type: "switch"; discriminant: Expression; cases: SwitchCase[] }
  | {
      type: "try"
      block: Statement[]
      handler?: CatchClause | undefined
      finalizer?: Statement[] | undefined
    }
  | {
      type: "class"
      id: string
      superClass?: Expression | undefined
      implements?: TSTypeDescriptor[] | undefined
      typeParameters?: TypeParameter[] | undefined
      body: ClassMember[]
    }
  | {
      type: "enum"
      id: string
      members: EnumMember[]
      const?: boolean | undefined
    }
  | {
      type: "import"
      specifiers: ImportSpecifier[]
      source: string
      typeOnly?: boolean | undefined
    }
  | {
      type: "export-named"
      declaration?: Statement | undefined
      specifiers?: ExportSpecifier[] | undefined
      source?: string | undefined
      typeOnly?: boolean | undefined
    }
  | {
      type: "export-default"
      declaration: Expression | Statement
    }
  | {
      type: "export-all"
      source: string
      exported?: string | undefined
    }
  | {
      type: "namespace"
      id: string
      body: Statement[]
    }
  | {
      type: "declare"
      declaration: Statement
    }
  | RawStatement

// TSTypeDescriptor types
export type ObjectPropertyDescriptor = {
  type: TSTypeDescriptor
  optional?: boolean | undefined
  readonly?: boolean | undefined
}

export type ReferenceTypeDescriptor = {
  kind: "reference"
  name: string
  typeArgs?: TSTypeDescriptor[] | undefined
  resolved?: TSTypeDescriptor | undefined
  __phantom?: unknown | undefined
}

export type GenericTypeDescriptor = {
  kind: "generic"
  name: string
  args: TSTypeDescriptor[]
  resolved?: TSTypeDescriptor | undefined
  __phantom?: unknown | undefined
}

export type MappedTypeDescriptor = {
  kind: "mapped"
  typeParam: {
    name: string
    constraint?: TSTypeDescriptor | undefined
    default?: TSTypeDescriptor | undefined
  }
  valueType: TSTypeDescriptor
  readonly?: true | "+" | "-" | undefined
  optional?: true | "+" | "-" | undefined
  nameType?: TSTypeDescriptor | undefined
}

export type ConditionalTypeDescriptor = {
  kind: "conditional"
  checkType: TSTypeDescriptor
  extendsType: TSTypeDescriptor
  trueType: TSTypeDescriptor
  falseType: TSTypeDescriptor
}

export type IndexedAccessTypeDescriptor = {
  kind: "indexed-access"
  objectType: TSTypeDescriptor
  indexType: TSTypeDescriptor
}

export type TypeQueryDescriptor = {
  kind: "typeof"
  name: string
  __phantom?: unknown | undefined
}

export type KeyofTypeDescriptor = {
  kind: "keyof"
  type: TSTypeDescriptor
}

export type TemplateLiteralTypeDescriptor = {
  kind: "template-literal"
  head: string
  spans: Array<{ type: TSTypeDescriptor; literal: string }>
}

export type InferTypeDescriptor = {
  kind: "infer"
  name: string
  constraint?: TSTypeDescriptor | undefined
}

export type TSTypeDescriptor =
  | {
      kind: "primitive"
      name:
        | "string"
        | "number"
        | "boolean"
        | "any"
        | "void"
        | "undefined"
        | "null"
        | "never"
        | "unknown"
    }
  | { kind: "array"; elementType: TSTypeDescriptor }
  | { kind: "union"; types: TSTypeDescriptor[] }
  | { kind: "intersection"; types: TSTypeDescriptor[] }
  | {
      kind: "function"
      params: TSTypeDescriptor[]
      returnType: TSTypeDescriptor
    }
  | {
      kind: "object"
      properties: Record<string, TSTypeDescriptor | ObjectPropertyDescriptor>
    }
  | GenericTypeDescriptor
  | ReferenceTypeDescriptor
  | { kind: "literal"; value: string | number | boolean | null }
  | {
      kind: "tuple"
      types: Array<TSTypeDescriptor | { type: TSTypeDescriptor; optional?: boolean | undefined }>
    }
  | MappedTypeDescriptor
  | ConditionalTypeDescriptor
  | IndexedAccessTypeDescriptor
  | TypeQueryDescriptor
  | KeyofTypeDescriptor
  | TemplateLiteralTypeDescriptor
  | InferTypeDescriptor

// Expression branding
export const ExprBrand = Symbol("Expr")
export type Branded<T> = T & { [ExprBrand]: true }

export function brand<T>(expr: T): Branded<T> {
  return { ...expr, [ExprBrand]: true } as any
}

export function isExpr(x: unknown): x is Expression {
  return !!x && typeof x === "object" && x !== null && ExprBrand in x
}
