import {
  addConstruct,
  type AnyNode,
  type Assignable,
  type Binding,
  binding,
  type Block,
  braces,
  builder,
  type Check,
  defineTarget,
  type Denotes,
  emit,
  type Equal,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type Fields,
  frag,
  type Fragment,
  functionConstruct,
  type Kind,
  type KindsOf,
  lessConstruct,
  type NodeClass,
  type Program,
  type Rejected,
  scope,
  type Stmt,
  stmt,
  stmtClass,
  structured,
  typeClass,
  type TypeLambda,
  type TypeNode,
  typeNode,
} from "../src/lang/index.ts"
import type {
  AssignNode,
  BinaryNode,
  CallNode,
  ExpressionNode,
  FunctionNode,
  IfNode,
  LetNode,
  RefNode,
  ReturnNode,
  WhileNode,
} from "../src/lang/index.ts"

export interface TsTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? (Equal<T, void> extends true ? false : true) : false
}

export interface TsSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [number, number] ? number
    : [A, B] extends [bigint, bigint] ? bigint
    : [A, B] extends [string, string | number | bigint | boolean] | [string | number | bigint | boolean, string] ? string
    : never
    : never
}

export interface TsCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [number, number] | [bigint, bigint] | [string, string] ? boolean : never
    : never
}

export interface TS {
  readonly name: "typescript"
  readonly Assign: Assignable
  readonly Truthy: TsTruthy
  readonly Sum: TsSum
  readonly Compare: TsCompare
}

declare const MeaningOf: unique symbol

export interface TsType<M extends TypeLambda, F extends Facts = Facts> extends TypeNode<TS, Evaluate<M>, F> {
  readonly [MeaningOf]: M
}

export type Evaluate<M extends TypeLambda, Env = {}> = Kind<M, [Env]>

export interface Const<D> extends TypeLambda {
  readonly type: D
}

export type MeaningOf<N> = N extends { readonly [MeaningOf]: infer M extends TypeLambda } ? M : Const<Denotes<N>>

type AnyType = TypeNode<TS, any, any>
type Env<Args> = Args extends readonly [infer E] ? E : never
type Meanings<T extends readonly AnyType[]> = { readonly [K in keyof T]: MeaningOf<T[K]> }
type Evaluated<M extends readonly TypeLambda[], E> = { -readonly [K in keyof M]: Evaluate<M[K], E> }
type Intersected<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail] ? Head & Intersected<Tail> : unknown

export interface ArrayMeaning<E extends TypeLambda> extends TypeLambda {
  readonly type: Evaluate<E, Env<this["Args"]>>[]
}

export interface UnionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Evaluate<M[number], Env<this["Args"]>>
}

export interface IntersectionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Intersected<Evaluated<M, Env<this["Args"]>>>
}

export interface TupleMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Evaluated<M, Env<this["Args"]>>
}

export interface Field<T extends AnyType = AnyType, R extends boolean = boolean, O extends boolean = boolean> {
  readonly type: T
  readonly readonly: R
  readonly optional: O
}

type FieldInput = AnyType | Field
type FieldOf<X extends FieldInput> =
    X extends Field<infer T, infer R, infer O> ? Field<T, R, O>
  : X extends AnyType ? Field<X, false, false>
  : never
type FieldMeaning<X extends FieldInput> = FieldOf<X> extends Field<infer T, infer R, infer O>
  ? { readonly m: MeaningOf<T>; readonly r: R; readonly o: O }
  : never

interface FieldMeanings {
  readonly [key: string]: { readonly m: TypeLambda; readonly r: boolean; readonly o: boolean }
}

type Modified<Fs extends FieldMeanings, E> =
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, true] ? K : never]?: Evaluate<Fs[K]["m"], E> }
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, false] ? K : never]: Evaluate<Fs[K]["m"], E> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, true] ? K : never]?: Evaluate<Fs[K]["m"], E> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, false] ? K : never]: Evaluate<Fs[K]["m"], E> }

type Flat<T> = { [K in keyof T]: T[K] } & {}

export interface ObjectMeaning<Fs extends FieldMeanings> extends TypeLambda {
  readonly type: Flat<Modified<Fs, Env<this["Args"]>>>
}

type Interpolable = string | number | bigint | boolean | null | undefined

type TemplateText<Parts extends readonly unknown[], E> =
    Parts extends readonly [infer Head, ...infer Tail] ?
      Head extends string ? `${Head}${TemplateText<Tail, E>}`
    : Head extends TypeLambda ? `${Extract<Evaluate<Head, E>, Interpolable>}${TemplateText<Tail, E>}`
    : never
  : ""

export interface TemplateMeaning<Parts extends readonly unknown[]> extends TypeLambda {
  readonly type: TemplateText<Parts, Env<this["Args"]>>
}

type TemplatePart = string | TypeNode<TS, Interpolable, any>
type TemplateMeanings<Parts extends readonly TemplatePart[]> = {
  readonly [K in keyof Parts]: Parts[K] extends string ? Parts[K] : MeaningOf<Parts[K]>
}
type TemplateFacts<Parts extends readonly TemplatePart[]> = FactsOf<Exclude<Parts[number], string>>
type NonLiteralPart<Parts extends readonly TemplatePart[]> = {
  [K in keyof Parts]: Parts[K] extends string ? (string extends Parts[K] ? Parts[K] : never) : never
}[number]

type LiteralValue = string | number | bigint | boolean | null

export interface KeyofMeaning<M extends TypeLambda> extends TypeLambda {
  readonly type: keyof Evaluate<M, Env<this["Args"]>>
}

export interface IndexMeaning<O extends TypeLambda, K extends TypeLambda> extends TypeLambda {
  readonly type: Evaluate<O, Env<this["Args"]>>[Evaluate<K, Env<this["Args"]>> & keyof Evaluate<O, Env<this["Args"]>>]
}

export interface TypeParam<C = unknown, F extends Facts = never> {
  readonly binding: Binding
  readonly constraint: TypeNode<TS, C, F> | undefined
}

type ParamFacts = { readonly kind: "type-param" }
type Arg<M extends TypeLambda, F extends Facts> = TsType<M, F | ParamFacts>
type ConstraintOf<P> = P extends TypeParam<infer C, any> ? C : unknown

export type AliasBody<P extends readonly TypeParam<any, any>[]> = <
  M1 extends Const<ConstraintOf<P[0]>>,
  F1 extends Facts,
  M2 extends Const<ConstraintOf<P[1]>>,
  F2 extends Facts,
  M3 extends Const<ConstraintOf<P[2]>>,
  F3 extends Facts,
  M4 extends Const<ConstraintOf<P[3]>>,
  F4 extends Facts,
>(first: Arg<M1, F1>, second: Arg<M2, F2>, third: Arg<M3, F3>, fourth: Arg<M4, F4>) => AnyType

type Specific<F> = F extends { readonly kind: infer K } ? (string extends K ? never : F) : never
type AliasFacts<P extends readonly TypeParam<any, any>[], B extends AliasBody<P>> =
  | { readonly kind: "type-alias" | "type-ref" | "type-param" }
  | FactsOf<P[number]["constraint"]>
  | Specific<FactsOf<ReturnType<B>>>
type Aliased<P extends readonly TypeParam<any, any>[], B> = P extends readonly [] ? (B extends () => infer R ? R : never) : B
type AliasResult<P extends readonly TypeParam<any, any>[], B extends AliasBody<P>> = P["length"] extends Parameters<B>["length"]
  ? Stmt<TS, AliasFacts<P, B>, Aliased<P, B>>
  : Rejected<"the body does not take one argument per type parameter", { params: P["length"]; arguments: Parameters<B>["length"] }>

export interface PrimitiveTypeNode {
  readonly kind: "primitive-type"
  readonly name: "number" | "string" | "boolean" | "bigint" | "symbol" | "void" | "null" | "undefined" | "unknown" | "never" | "any" | "object"
}
export interface ArrayTypeNode {
  readonly kind: "array-type"
  readonly element: AnyNode
}
export interface LiteralTypeNode {
  readonly kind: "literal-type"
  readonly value: LiteralValue
}
export interface ObjectTypeNode {
  readonly kind: "object-type"
  readonly fields: ReadonlyArray<{ readonly key: string } & Field>
}
export interface MembersTypeNode {
  readonly kind: "union-type" | "intersection-type"
  readonly members: ReadonlyArray<AnyNode>
}
export interface TupleTypeNode {
  readonly kind: "tuple-type"
  readonly elements: ReadonlyArray<AnyNode>
}
export interface TemplateTypeNode {
  readonly kind: "template-type"
  readonly parts: ReadonlyArray<string | AnyNode>
}
export interface KeyofTypeNode {
  readonly kind: "keyof-type"
  readonly operand: AnyNode
}
export interface IndexTypeNode {
  readonly kind: "index-type"
  readonly object: AnyNode
  readonly index: AnyNode
}
export interface TypeAliasNode {
  readonly kind: "type-alias"
  readonly binding: Binding
  readonly params: ReadonlyArray<TypeParam<unknown, Facts>>
  readonly body: Block
}
export interface TypeRefNode {
  readonly kind: "type-ref" | "type-param"
  readonly binding: Binding
  readonly args: ReadonlyArray<AnyNode>
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number | string | boolean | bigint
}

const primitiveClass = typeClass<PrimitiveTypeNode>()
const arrayClass = typeClass<ArrayTypeNode>({ children: (node) => [node.element] })
const literalTypeClass = typeClass<LiteralTypeNode>()
const objectClass = typeClass<ObjectTypeNode>({ children: (node) => node.fields.map((field) => field.type) })
const membersClass = typeClass<MembersTypeNode>({ children: (node) => node.members })
const tupleClass = typeClass<TupleTypeNode>({ children: (node) => node.elements })
const templateClass = typeClass<TemplateTypeNode>({ children: (node) => node.parts.filter((part) => typeof part !== "string") })
const keyofClass = typeClass<KeyofTypeNode>({ children: (node) => [node.operand] })
const indexClass = typeClass<IndexTypeNode>({ children: (node) => [node.object, node.index] })
const aliasClass = stmtClass<TypeAliasNode>({
  children: (node) => [...node.params.flatMap((param) => (param.constraint === undefined ? [] : [param.constraint])), node.body],
  declares: (node) => [node.binding],
})
const typeRefClass = typeClass<TypeRefNode>({ children: (node) => node.args, references: (node) => [node.binding] })
const literalClass = exprClass<LiteralNode>()

const tsType = <M extends TypeLambda, F extends Facts>(
  nodeClass: NodeClass<any>,
  fields: Fields,
): TsType<M, F> => typeNode<TS, Evaluate<M>, F>(nodeClass, fields) as TsType<M, F>

type PrimitiveFacts = { readonly kind: "primitive-type" }
const primitive = <D>(name: PrimitiveTypeNode["name"]): TsType<Const<D>, PrimitiveFacts> => tsType(primitiveClass, { kind: "primitive-type", name })

const field = (value: FieldInput): Field => ("role" in value ? { type: value, readonly: false, optional: false } : value)

export const ts = {
  ...structured<TS>(),
  ...functionConstruct<TS>(),
  ...addConstruct<TS>(),
  ...lessConstruct<TS>(),

  number: primitive<number>("number"),
  string: primitive<string>("string"),
  boolean: primitive<boolean>("boolean"),
  bigint: primitive<bigint>("bigint"),
  symbol: primitive<symbol>("symbol"),
  void: primitive<void>("void"),
  null: primitive<null>("null"),
  undefined: primitive<undefined>("undefined"),
  unknown: primitive<unknown>("unknown"),
  never: primitive<never>("never"),
  any: primitive<any>("any"),
  nonPrimitive: primitive<object>("object"),

  array: <E extends AnyType>(element: E): TsType<ArrayMeaning<MeaningOf<E>>, { readonly kind: "array-type" } | FactsOf<E>> =>
    tsType(arrayClass, { kind: "array-type", element }),

  literalType: <const V extends LiteralValue>(value: V): TsType<Const<V>, { readonly kind: "literal-type" }> => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`a literal type must be a finite number, got ${value}`)
    return tsType(literalTypeClass, { kind: "literal-type", value })
  },

  readonly: <const X extends FieldInput>(value: X): Field<FieldOf<X>["type"], true, FieldOf<X>["optional"]> =>
    ({ ...field(value), readonly: true }) as Field<FieldOf<X>["type"], true, FieldOf<X>["optional"]>,

  optional: <const X extends FieldInput>(value: X): Field<FieldOf<X>["type"], FieldOf<X>["readonly"], true> =>
    ({ ...field(value), optional: true }) as Field<FieldOf<X>["type"], FieldOf<X>["readonly"], true>,

  object: <const Fs extends { readonly [key: string]: FieldInput }>(
    fields: Fs,
  ): TsType<
    ObjectMeaning<{ readonly [K in keyof Fs & string]: FieldMeaning<Fs[K]> }>,
    { readonly kind: "object-type" } | FactsOf<FieldOf<Fs[keyof Fs]>["type"]>
  > => tsType(objectClass, { kind: "object-type", fields: Object.entries(fields).map(([key, value]) => ({ key, ...field(value) })) }),

  union: <const T extends readonly [AnyType, AnyType, ...AnyType[]]>(
    ...members: T
  ): TsType<UnionMeaning<Meanings<T>>, { readonly kind: "union-type" } | FactsOf<T[number]>> => tsType(membersClass, { kind: "union-type", members }),

  intersection: <const T extends readonly [AnyType, AnyType, ...AnyType[]]>(
    ...members: T
  ): TsType<IntersectionMeaning<Meanings<T>>, { readonly kind: "intersection-type" } | FactsOf<T[number]>> =>
    tsType(membersClass, { kind: "intersection-type", members }),

  tuple: <const T extends readonly AnyType[]>(
    ...elements: T
  ): TsType<TupleMeaning<Meanings<T>>, { readonly kind: "tuple-type" } | FactsOf<T[number]>> => tsType(tupleClass, { kind: "tuple-type", elements }),

  keyof: <T extends AnyType>(operand: T): TsType<KeyofMeaning<MeaningOf<T>>, { readonly kind: "keyof-type" } | FactsOf<T>> =>
    tsType(keyofClass, { kind: "keyof-type", operand }),

  index: <O extends AnyType, K extends TypeNode<TS, keyof Denotes<O>, any>>(
    object: O,
    index: K,
  ): TsType<IndexMeaning<MeaningOf<O>, MeaningOf<K>>, { readonly kind: "index-type" } | FactsOf<O> | FactsOf<K>> =>
    tsType(indexClass, { kind: "index-type", object, index }),

  typeParam: <C = unknown, F extends Facts = never>(nameHint: string, constraint?: TypeNode<TS, C, F>): TypeParam<NoInfer<C>, NoInfer<F>> => ({
    binding: binding(nameHint),
    constraint,
  }),

  alias: <const P extends readonly TypeParam<any, any>[], B extends AliasBody<P>>(
    name: string,
    params: P,
    body: B,
  ): AliasResult<P, B> => {
    if (body.length !== params.length) {
      throw new Error(`the body of type alias "${name}" takes ${body.length} arguments for ${params.length} type parameters`)
    }
    const declared = binding(name)
    const refs = params.map((param) => tsType(typeRefClass, { kind: "type-param", binding: param.binding, args: [] }))
    const block = scope(params.map((param) => param.binding), [(body as unknown as (...refs: AnyType[]) => AnyType)(...refs)])
    const apply = (...args: AnyType[]) => tsType(typeRefClass, { kind: "type-ref", binding: declared, args })
    return stmt(aliasClass, { kind: "type-alias", binding: declared, params, body: block }, params.length === 0 ? apply() : apply) as AliasResult<
      P,
      B
    >
  },

  template: <const Parts extends readonly TemplatePart[]>(
    ...parts:
      & Parts
      & Check<[NonLiteralPart<Parts>] extends [never] ? true : false, "a template's text must be a literal string", { part: NonLiteralPart<Parts> }>
  ): TsType<TemplateMeaning<TemplateMeanings<Parts>>, { readonly kind: "template-type" } | TemplateFacts<Parts>> =>
    tsType(templateClass, { kind: "template-type", parts }),

  literal: <const V extends number | string | boolean | bigint>(value: V): Expr<TS, V, { readonly kind: "literal" }> =>
    expr(literalClass, { kind: "literal", value }),

  program: <Y extends Stmt<TS, any, any>>(body: () => Generator<Y, void, unknown>): Program<TS, KindsOf<Y>> => builder<TS>()(body),
}

const KEYWORDS = (
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if "
  + "implements import in instanceof interface let new null package private protected public return static super switch this throw "
  + "true try typeof var void while with yield"
).split(" ")

const POSTFIX = 17
const UNARY = 14
const MULTIPLY = 13
const ADD = 12
const RELATIONAL = 10

const TYPE_UNION = 1
const TYPE_INTERSECTION = 2
const TYPE_OPERATOR = 3
const TYPE_POSTFIX = 4

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u

const propertyKey = (key: string): string => (IDENTIFIER.test(key) ? key : JSON.stringify(key))

const templateText = (text: string): string => text.replace(/[`\\]|\$\{/g, (match) => `\\${match}`)

const literalText = (value: LiteralValue): string => (typeof value === "bigint" ? `${value}n` : value === null ? "null" : JSON.stringify(value))

export const tsTarget = defineTarget({
  valid: (name) => IDENTIFIER.test(name),
  reserved: new Set(KEYWORDS),
}, {
  "primitive-type": (node: PrimitiveTypeNode) => node.name,
  "array-type": (node: ArrayTypeNode, emit) => frag(TYPE_POSTFIX, `${emit.at(node.element, TYPE_POSTFIX)}[]`),
  "literal-type": (node: LiteralTypeNode) => literalText(node.value),
  "object-type": (node: ObjectTypeNode, emit) =>
    node.fields.length === 0
      ? "{}"
      : `{ ${
        node.fields.map((field) =>
          `${field.readonly ? "readonly " : ""}${propertyKey(field.key)}${field.optional ? "?" : ""}: ${emit.node(field.type).text}`
        )
          .join("; ")
      } }`,
  "union-type": (node: MembersTypeNode, emit) => frag(TYPE_UNION, node.members.map((member) => emit.at(member, TYPE_UNION)).join(" | ")),
  "intersection-type": (node: MembersTypeNode, emit) =>
    frag(TYPE_INTERSECTION, node.members.map((member) => emit.at(member, TYPE_INTERSECTION)).join(" & ")),
  "tuple-type": (node: TupleTypeNode, emit) => `[${node.elements.map((element) => emit.node(element).text).join(", ")}]`,
  "keyof-type": (node: KeyofTypeNode, emit) => frag(TYPE_OPERATOR, `keyof ${emit.at(node.operand, TYPE_OPERATOR)}`),
  "index-type": (node: IndexTypeNode, emit) => frag(TYPE_POSTFIX, `${emit.at(node.object, TYPE_POSTFIX)}[${emit.node(node.index).text}]`),
  "type-param": (node: TypeRefNode, emit) => emit.name(node.binding),
  "type-ref": (node: TypeRefNode, emit) =>
    node.args.length === 0 ? emit.name(node.binding) : `${emit.name(node.binding)}<${node.args.map((arg) => emit.node(arg).text).join(", ")}>`,
  "type-alias": (node: TypeAliasNode, emit) => {
    const params = node.params.map((param) =>
      param.constraint === undefined ? emit.name(param.binding) : `${emit.name(param.binding)} extends ${emit.node(param.constraint).text}`
    )
    const body = node.body.statements[0]
    if (body === undefined) throw new Error("a type alias needs a body")
    return `type ${emit.name(node.binding)}${params.length === 0 ? "" : `<${params.join(", ")}>`} = ${emit.node(body).text};`
  },
  "template-type": (node: TemplateTypeNode, emit) =>
    `\`${node.parts.map((part) => (typeof part === "string" ? templateText(part) : `\${${emit.node(part).text}}`)).join("")}\``,
  literal: (node: LiteralNode): Fragment => {
    const { value } = node
    if (typeof value === "bigint") return frag(value < 0n ? UNARY : POSTFIX, `${value}n`)
    if (typeof value === "string") return frag(POSTFIX, JSON.stringify(value))
    if (typeof value === "boolean") return frag(POSTFIX, String(value))
    if (Object.is(value, -0)) return frag(UNARY, "-0")
    if (Number.isNaN(value)) return frag(MULTIPLY, "0 / 0")
    if (value === Infinity) return frag(MULTIPLY, "1 / 0")
    if (value === -Infinity) return frag(MULTIPLY, "-1 / 0")
    return frag(value < 0 ? UNARY : POSTFIX, String(value))
  },
  ref: (node: RefNode, emit) => emit.name(node.binding),
  add: (node: BinaryNode, emit) => ({ prec: ADD, text: `${emit.at(node.left, ADD)} + ${emit.at(node.right, ADD + 1)}` }),
  less: (node: BinaryNode, emit) => ({ prec: RELATIONAL, text: `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}` }),
  call: (node: CallNode, emit) => ({
    prec: POSTFIX,
    text: `${emit.at(node.callee, POSTFIX)}(${node.args.map((arg) => emit.node(arg).text).join(", ")})`,
  }),
  let: (node: LetNode, emit) => `let ${emit.name(node.binding)}: ${emit.node(node.type).text} = ${emit.node(node.init).text};`,
  assign: (node: AssignNode, emit) => `${emit.node(node.target).text} = ${emit.node(node.value).text};`,
  expression: (node: ExpressionNode, emit) => `${emit.node(node.expr).text};`,
  if: (node: IfNode, emit) => {
    const then = `if (${emit.node(node.condition).text}) ${braces(emit.block(node.then))}`
    return node.else === undefined ? then : `${then} else ${braces(emit.block(node.else))}`
  },
  while: (node: WhileNode, emit) => `while (${emit.node(node.condition).text}) ${braces(emit.block(node.body))}`,
  return: (node: ReturnNode, emit) => `return ${emit.node(node.value).text};`,
  function: (node: FunctionNode, emit) => {
    const params = node.params.map((param) => `${emit.name(param.binding)}: ${emit.node(param.type).text}`).join(", ")
    return `function ${emit.name(node.binding)}(${params}): ${emit.node(node.returns).text} ${braces(emit.block(node.body))}`
  },
})

export const emitTs = <Kinds extends keyof typeof tsTarget.handlers>(program: Program<TS, Kinds>): string =>
  emit(program as Program<TS, keyof typeof tsTarget.handlers>, tsTarget)
