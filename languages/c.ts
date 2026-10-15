/**
 * A C subset with its own type system: integers of each width and signedness, `double`, pointers and `void`.
 * Programs are checked by C's rules in the editor, not TypeScript's.
 *
 * Checked at build time rather than compile time:
 * - scopes: every reference resolves to a binding in scope (the kernel's scope pass)
 * - only `let` and function declarations may appear at the top level
 * - names: a binding whose hint is not a C identifier fails at emission
 *
 * Not checked: whether a non-`void` function returns on every path. That is order-sensitive, and a body's
 * facts are an unordered union.
 */
import {
  addConstruct,
  type AnyOf,
  type Both,
  braces,
  builder,
  defineTarget,
  emit,
  type Expr,
  expr,
  exprClass,
  type Facts,
  functionConstruct,
  type Handler,
  type KindsOf,
  lessConstruct,
  type Program,
  type Same,
  type Stmt,
  structured,
  typeClass,
  type TypeLambda,
  type TypeNode,
  typeNode,
  type Under,
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

// ---------- denotations ----------

export type Bits = 8 | 16 | 32 | 64

export interface Int<B extends Bits = Bits, Signed extends boolean = boolean> {
  readonly c: "int"
  readonly bits: B
  readonly signed: Signed
}
export interface Double {
  readonly c: "double"
}
export interface Ptr<T> {
  readonly c: "pointer"
  readonly to: T
}
export interface Void {
  readonly c: "void"
}

export type Arith = Int | Double
export type Scalar = Arith | Ptr<unknown>

// ---------- rules ----------

type Wider<A extends Bits, B extends Bits> =
    A extends 64 ? 64
  : B extends 64 ? 64
  : A extends 32 ? 32
  : B extends 32 ? 32
  : A extends 16 ? 16
  : B extends 16 ? 16
  : 8

/** the integer promotions: anything narrower than `int` becomes `int` */
type Promoted<B extends Bits> = B extends 8 | 16 ? 32 : B

/** the usual arithmetic conversions, simplified: `double` wins, then the wider integer, then unsigned */
export type Converted<A, B> =
    [A, B] extends [Double, Arith] | [Arith, Double] ? Double
  : [A, B] extends [Int<infer X, infer SA>, Int<infer Y, infer SB>] ? Int<
    Wider<Promoted<X>, Promoted<Y>>,
    [SA, SB] extends [true, true] ? true : false
  >
  : never

/** `[Ptr<T>] -> [T]`, a pattern for `Under` */
export interface Pointee extends TypeLambda {
  readonly type: this["Args"] extends readonly [Ptr<infer T>] ? [T] : never
}

/** implicit conversion: between any two arithmetic types, or between pointers to exactly the same type */
export type CAssign = AnyOf<Both<Arith>, Under<Pointee, Same>>

/** conditions are scalars: arithmetic values or pointers */
export interface CTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? ([T] extends [Scalar] ? true : false) : false
}

/** `+`: arithmetic operands convert; a pointer plus an integer is the same pointer */
export interface CSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? ([A, B] extends [Ptr<unknown>, Int] ? A : Converted<A, B>) : never
}

/** `<`: arithmetic operands; the result is an `int` */
export interface CCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? [Converted<A, B>] extends [never] ? never : Int<32, true> : never
}

/** the C language: a record of capabilities */
export interface C {
  readonly name: "c"
  readonly Assign: CAssign
  readonly Truthy: CTruthy
  readonly Sum: CSum
  readonly Compare: CCompare
}

// ---------- constructs ----------

export interface IntTypeNode {
  readonly kind: "int-type"
  readonly bits: Bits
  readonly signed: boolean
}
export interface PointerTypeNode {
  readonly kind: "pointer-type"
  readonly to: TypeNode<C, unknown>
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number
  readonly type: TypeNode<C, unknown>
}
export interface UnaryNode {
  readonly kind: "address" | "deref"
  readonly operand: Expr<C, unknown>
}

const intTypeClass = typeClass<IntTypeNode>()
const doubleTypeClass = typeClass()
const voidTypeClass = typeClass()
const pointerTypeClass = typeClass<PointerTypeNode>({ children: (node) => [node.to] })
const literalClass = exprClass<LiteralNode>({ children: (node) => [node.type] })
const unaryClass = exprClass<UnaryNode>({ children: (node) => [node.operand] })

type IntFacts = { readonly kind: "int-type" }

const int = <B extends Bits>(bits: B): TypeNode<C, Int<B, true>, IntFacts> => typeNode(intTypeClass, { kind: "int-type", bits, signed: true })
const uint = <B extends Bits>(bits: B): TypeNode<C, Int<B, false>, IntFacts> => typeNode(intTypeClass, { kind: "int-type", bits, signed: false })

export const c = {
  ...structured<C>(),
  ...functionConstruct<C>(),
  ...addConstruct<C>(),
  ...lessConstruct<C>(),

  int,
  uint,
  double: typeNode<C, Double, { readonly kind: "double-type" }>(doubleTypeClass, { kind: "double-type" }),
  void: typeNode<C, Void, { readonly kind: "void-type" }>(voidTypeClass, { kind: "void-type" }),
  ptr: <T, F extends Facts>(to: TypeNode<C, T, F>): TypeNode<C, Ptr<T>, { readonly kind: "pointer-type" } | F> =>
    typeNode(pointerTypeClass, { kind: "pointer-type", to }),

  /** a numeric constant of the given arithmetic type */
  literal: <D extends Arith, F extends Facts>(type: TypeNode<C, D, F>, value: number): Expr<C, D, { readonly kind: "literal" } | F> =>
    expr(literalClass, { kind: "literal", value, type }),
  /** `&x` */
  address: <D, F extends Facts>(operand: Expr<C, D, F>): Expr<C, Ptr<D>, { readonly kind: "address" } | F> =>
    expr(unaryClass, { kind: "address", operand }),
  /** `*p` */
  deref: <D, F extends Facts>(operand: Expr<C, Ptr<D>, F>): Expr<C, D, { readonly kind: "deref" } | F> =>
    expr(unaryClass, { kind: "deref", operand }),

  /** builds a C translation unit; only declarations may appear at its top level */
  program: <Y extends Stmt<C, any, any>>(body: () => Generator<Y, void, unknown>): Program<C, KindsOf<Y>> => {
    const program = builder<C>()(body)
    for (const statement of program.root.statements) {
      if (statement.kind !== "let" && statement.kind !== "function") {
        throw new Error(`"${statement.kind}" cannot appear at the top level of a C program`)
      }
    }
    return program
  },
}

// ---------- target ----------

const KEYWORDS = (
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return "
  + "short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary"
).split(" ")

const UNARY = 14
const POSTFIX = 15
const ADD = 12
const RELATIONAL = 10

const intName = (node: IntTypeNode): string => `${node.signed ? "" : "u"}int${node.bits}_t`

const declaration = (type: TypeNode<C, unknown>, name: string, emit: Parameters<Handler>[1]): string => `${emit.node(type).text} ${name}`

/** C source text; integers are spelled as `<stdint.h>` fixed-width types */
export const cTarget = defineTarget(
  { valid: (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name), reserved: new Set(KEYWORDS) },
  {
    "int-type": (node: IntTypeNode) => intName(node),
    "double-type": () => "double",
    "void-type": () => "void",
    "pointer-type": (node: PointerTypeNode, emit) => `${emit.node(node.to).text}*`,
    literal: (node: LiteralNode) => {
      const text = Number.isInteger(node.value) && node.type.kind === "double-type" ? `${node.value}.0` : String(node.value)
      return node.value < 0 ? { prec: UNARY, text } : text
    },
    ref: (node: RefNode, emit) => emit.name(node.binding),
    address: (node: UnaryNode, emit) => ({ prec: UNARY, text: `&${emit.at(node.operand, UNARY)}` }),
    deref: (node: UnaryNode, emit) => ({ prec: UNARY, text: `*${emit.at(node.operand, UNARY)}` }),
    add: (node: BinaryNode, emit) => ({ prec: ADD, text: `${emit.at(node.left, ADD)} + ${emit.at(node.right, ADD + 1)}` }),
    less: (node: BinaryNode, emit) => ({ prec: RELATIONAL, text: `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}` }),
    call: (node: CallNode, emit) => ({
      prec: POSTFIX,
      text: `${emit.at(node.callee, POSTFIX)}(${node.args.map((arg) => emit.node(arg).text).join(", ")})`,
    }),
    let: (node: LetNode, emit) => `${declaration(node.type as TypeNode<C, unknown>, emit.name(node.binding), emit)} = ${emit.node(node.init).text};`,
    assign: (node: AssignNode, emit) => `${emit.node(node.target).text} = ${emit.node(node.value).text};`,
    expression: (node: ExpressionNode, emit) => `${emit.node(node.expr).text};`,
    if: (node: IfNode, emit) => {
      const then = `if (${emit.node(node.condition).text}) ${braces(emit.block(node.then))}`
      return node.else === undefined ? then : `${then} else ${braces(emit.block(node.else))}`
    },
    while: (node: WhileNode, emit) => `while (${emit.node(node.condition).text}) ${braces(emit.block(node.body))}`,
    return: (node: ReturnNode, emit) => `return ${emit.node(node.value).text};`,
    function: (node: FunctionNode, emit) => {
      const params = node.params.map((param) => declaration(param.type as TypeNode<C, unknown>, emit.name(param.binding), emit))
      return `${emit.node(node.returns).text} ${emit.name(node.binding)}(${params.length === 0 ? "void" : params.join(", ")}) ${
        braces(emit.block(node.body))
      }`
    },
  },
)

/** a complete C source file for a program whose node kinds the C target handles */
export const emitC = <Kinds extends keyof typeof cTarget.handlers>(program: Program<C, Kinds>): string =>
  `#include <stdint.h>\n\n${emit(program as Program<C, keyof typeof cTarget.handlers>, cTarget)}\n`
