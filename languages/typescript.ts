import {
  addConstruct,
  type Assignable,
  braces,
  builder,
  defineTarget,
  emit,
  type Equal,
  type Expr,
  expr,
  exprClass,
  type Facts,
  frag,
  type Fragment,
  functionConstruct,
  type KindsOf,
  lessConstruct,
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

export interface PrimitiveTypeNode {
  readonly kind: "primitive-type"
  readonly name: "number" | "string" | "boolean" | "bigint" | "void"
}
export interface ArrayTypeNode {
  readonly kind: "array-type"
  readonly element: TypeNode<TS, unknown>
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number | string | boolean | bigint
}

const primitiveClass = typeClass<PrimitiveTypeNode>()
const arrayClass = typeClass<ArrayTypeNode>({ children: (node) => [node.element] })
const literalClass = exprClass<LiteralNode>()

type PrimitiveFacts = { readonly kind: "primitive-type" }
const primitive = <D>(name: PrimitiveTypeNode["name"]): TypeNode<TS, D, PrimitiveFacts> => typeNode(primitiveClass, { kind: "primitive-type", name })

export const ts = {
  ...structured<TS>(),
  ...functionConstruct<TS>(),
  ...addConstruct<TS>(),
  ...lessConstruct<TS>(),

  number: primitive<number>("number"),
  string: primitive<string>("string"),
  boolean: primitive<boolean>("boolean"),
  bigint: primitive<bigint>("bigint"),
  void: primitive<void>("void"),
  array: <D, F extends Facts>(element: TypeNode<TS, D, F>): TypeNode<TS, D[], { readonly kind: "array-type" } | F> =>
    typeNode(arrayClass, { kind: "array-type", element }),

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

export const tsTarget = defineTarget({
  valid: (name) => /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u.test(name),
  reserved: new Set(KEYWORDS),
}, {
  "primitive-type": (node: PrimitiveTypeNode) => node.name,
  "array-type": (node: ArrayTypeNode, emit) => `${emit.node(node.element).text}[]`,
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
