import {
  addConstruct,
  type AnyNode,
  type Assignable,
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
  type Stmt,
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
type Meanings<T extends readonly AnyType[]> = { readonly [K in keyof T]: MeaningOf<T[K]> }
type Evaluated<M extends readonly TypeLambda[], Args extends readonly unknown[]> = { -readonly [K in keyof M]: Kind<M[K], Args> }
type Intersected<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail] ? Head & Intersected<Tail> : unknown

export interface ArrayMeaning<E extends TypeLambda> extends TypeLambda {
  readonly type: Kind<E, this["Args"]>[]
}

export interface UnionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Kind<M[number], this["Args"]>
}

export interface IntersectionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Intersected<Evaluated<M, this["Args"]>>
}

export interface TupleMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Evaluated<M, this["Args"]>
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

type Modified<Fs extends FieldMeanings, Args extends readonly unknown[]> =
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, true] ? K : never]?: Kind<Fs[K]["m"], Args> }
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, false] ? K : never]: Kind<Fs[K]["m"], Args> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, true] ? K : never]?: Kind<Fs[K]["m"], Args> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, false] ? K : never]: Kind<Fs[K]["m"], Args> }

type Flat<T> = { [K in keyof T]: T[K] } & {}

export interface ObjectMeaning<Fs extends FieldMeanings> extends TypeLambda {
  readonly type: Flat<Modified<Fs, this["Args"]>>
}

type Interpolable = string | number | bigint | boolean | null | undefined

type TemplateText<Parts extends readonly unknown[], Args extends readonly unknown[]> =
    Parts extends readonly [infer Head, ...infer Tail] ?
      Head extends string ? `${Head}${TemplateText<Tail, Args>}`
    : Head extends TypeLambda ? `${Extract<Kind<Head, Args>, Interpolable>}${TemplateText<Tail, Args>}`
    : never
  : ""

export interface TemplateMeaning<Parts extends readonly unknown[]> extends TypeLambda {
  readonly type: TemplateText<Parts, this["Args"]>
}

type TemplatePart = string | AnyType
type TemplateMeanings<Parts extends readonly TemplatePart[]> = {
  readonly [K in keyof Parts]: Parts[K] extends AnyType ? MeaningOf<Parts[K]> : Parts[K]
}
type TemplateFacts<Parts extends readonly TemplatePart[]> = FactsOf<Extract<Parts[number], AnyType>>
type BadTemplatePart<Parts extends readonly TemplatePart[]> = {
  [K in keyof Parts]: Parts[K] extends string ? (string extends Parts[K] ? Parts[K] : never)
    : [Denotes<Parts[K]>] extends [Interpolable] ? never : Denotes<Parts[K]>
}[number]

type LiteralValue = string | number | bigint | boolean | null

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

  template: <const Parts extends readonly TemplatePart[]>(
    ...parts:
      & Parts
      & Check<[BadTemplatePart<Parts>] extends [never] ? true : false, "a template part must be a literal string or an interpolable type", {
        part: BadTemplatePart<Parts>
      }>
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
