/**
 * A C subset with its own type system: integers of each width and signedness, `double`, pointers and `void`.
 * Programs are checked by C's rules in the editor, not TypeScript's.
 *
 * Checked at build time rather than compile time:
 * - scopes: every reference resolves to a binding in scope (the kernel's scope pass)
 * - only `let` and function declarations may appear at the top level, and a top-level `let` needs a constant
 *   initializer: literals and `+` or `<` of them, or the address of a binding plus or minus nothing but integer constants
 * - functions do not nest: a function body contains no function declaration
 * - literals: an integer literal is an integer its type can hold exactly
 * - names: a binding whose hint is not a C identifier fails at emission
 *
 * Not checked: whether a non-`void` function returns on every path. That is order-sensitive, and a body's
 * facts are an unordered union.
 */
import {
  addConstruct,
  type AnyNode,
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
  frag,
  type Fragment,
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
  walk,
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

/** the integer promotions: `int` is 32 bits, and anything narrower, signed or not, becomes `int` */
type Promoted<T> = T extends Int<8 | 16, boolean> ? Int<32, true> : T

/**
 * Integer conversion of promoted operands: the wider type wins, signedness included, since a wider signed type
 * holds every value of a narrower unsigned one; at equal width, unsigned wins.
 */
type IntConverted<X extends Bits, SA extends boolean, Y extends Bits, SB extends boolean> =
    [X] extends [Y] ? Int<X, [SA, SB] extends [true, true] ? true : false>
  : [Wider<X, Y>] extends [X] ? Int<X, SA>
  : Int<Y, SB>

/** the usual arithmetic conversions: `double` wins, then the integer promotions and integer conversion */
export type Converted<A, B> =
    [A, B] extends [Double, Arith] | [Arith, Double] ? Double
  : [Promoted<A>, Promoted<B>] extends [Int<infer X, infer SA>, Int<infer Y, infer SB>] ? IntConverted<X, SA, Y, SB>
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

/** `+`: arithmetic operands convert; a pointer plus an integer, in either order, is the same pointer */
export interface CSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [Ptr<unknown>, Int] ? A : [A, B] extends [Int, Ptr<unknown>] ? B : Converted<A, B>
    : never
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

const intName = (node: IntTypeNode): string => `${node.signed ? "" : "u"}int${node.bits}_t`

/** a node's fields, for a node whose kind has been checked */
const fieldsOf = <N>(node: AnyNode): N => node as unknown as N

const checkedLiteral = (type: AnyNode, value: number): number => {
  if (type.kind !== "int-type") return value
  const node = fieldsOf<IntTypeNode>(type)
  const min = node.signed ? -(2 ** (node.bits - 1)) : 0
  const max = node.signed ? 2 ** (node.bits - 1) - 1 : 2 ** node.bits - 1
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${intName(node)} cannot hold the literal ${value} exactly`)
  }
  return value
}

/** an arithmetic constant expression */
const isArithmeticConstant = (node: AnyNode): boolean =>
  node.kind === "literal"
  || ((node.kind === "add" || node.kind === "less") && isArithmeticConstant(fieldsOf<BinaryNode>(node).left)
    && isArithmeticConstant(fieldsOf<BinaryNode>(node).right))

/** an address constant: `&x`, offset by integer constants */
const isAddressConstant = (node: AnyNode): boolean => {
  if (node.kind === "address") return fieldsOf<UnaryNode>(node).operand.kind === "ref"
  if (node.kind !== "add") return false
  const { left, right } = fieldsOf<BinaryNode>(node)
  return (isAddressConstant(left) && isArithmeticConstant(right)) || (isArithmeticConstant(left) && isAddressConstant(right))
}

const checkTopLevel = (statement: AnyNode): void => {
  if (statement.kind === "let") {
    const node = fieldsOf<LetNode>(statement)
    if (!isArithmeticConstant(node.init) && !isAddressConstant(node.init)) {
      throw new Error(`the top-level "let" of "${node.binding.nameHint}" needs a constant initializer in C`)
    }
  } else if (statement.kind === "function") {
    walk(fieldsOf<FunctionNode>(statement).body, (node) => {
      if (node.kind === "function") {
        throw new Error(`function "${fieldsOf<FunctionNode>(node).binding.nameHint}" cannot be nested in another function in C`)
      }
    })
  } else {
    throw new Error(`"${statement.kind}" cannot appear at the top level of a C program`)
  }
}

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
    expr(literalClass, { kind: "literal", value: checkedLiteral(type, value), type }),
  /** `&x` */
  address: <D, F extends Facts>(operand: Expr<C, D, F>): Expr<C, Ptr<D>, { readonly kind: "address" } | F> =>
    expr(unaryClass, { kind: "address", operand }),
  /** `*p` */
  deref: <D, F extends Facts>(operand: Expr<C, Ptr<D>, F>): Expr<C, D, { readonly kind: "deref" } | F> =>
    expr(unaryClass, { kind: "deref", operand }),

  /** builds a C translation unit; only declarations with constant initializers may appear at its top level */
  program: <Y extends Stmt<C, any, any>>(body: () => Generator<Y, void, unknown>): Program<C, KindsOf<Y>> => {
    const program = builder<C>()(body)
    program.root.statements.forEach(checkTopLevel)
    return program
  },
}

// ---------- target ----------

const KEYWORDS = (
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return "
  + "short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary"
).split(" ")

/** what `<stdint.h>` declares, which the emitted file includes */
const STDINT = [
  ..."intptr_t uintptr_t intmax_t uintmax_t INTPTR_MIN INTPTR_MAX UINTPTR_MAX INTMAX_MIN INTMAX_MAX UINTMAX_MAX INTMAX_C UINTMAX_C".split(" "),
  ..."PTRDIFF_MIN PTRDIFF_MAX SIZE_MAX SIG_ATOMIC_MIN SIG_ATOMIC_MAX WCHAR_MIN WCHAR_MAX WINT_MIN WINT_MAX".split(" "),
  ...[8, 16, 32, 64].flatMap((bits) =>
    ["", "_LEAST", "_FAST"].flatMap((width) => {
      const type = width.toLowerCase()
      return [`int${type}${bits}_t`, `uint${type}${bits}_t`, `INT${width}${bits}_MIN`, `INT${width}${bits}_MAX`, `UINT${width}${bits}_MAX`]
    }).concat([`INT${bits}_C`, `UINT${bits}_C`])
  ),
]

const UNARY = 14
const POSTFIX = 15
const MULTIPLY = 13
const ADD = 12
const RELATIONAL = 10

/**
 * A literal spelled so that C gives it its declared type. An unsuffixed constant is an `int`, which is what
 * an 8- or 16-bit value promotes to anyway; wider unsigned and 64-bit values use `<stdint.h>`'s constant macros.
 */
const intLiteral = (node: IntTypeNode, value: number): Fragment => {
  if (node.bits === 32 && node.signed && value === -(2 ** 31)) return frag(POSTFIX, "INT32_MIN")
  const magnitude = node.bits < 32 || (node.bits === 32 && node.signed)
    ? String(Math.abs(value))
    : `${node.signed ? "" : "U"}INT${node.bits}_C(${Math.abs(value)})`
  return value < 0 ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
}

const doubleLiteral = (value: number): Fragment => {
  if (Number.isNaN(value)) return frag(MULTIPLY, "0.0 / 0.0")
  if (value === Infinity) return frag(MULTIPLY, "1.0 / 0.0")
  if (value === -Infinity) return frag(MULTIPLY, "-1.0 / 0.0")
  const digits = String(Math.abs(value))
  const magnitude = /[.e]/.test(digits) ? digits : `${digits}.0`
  return value < 0 || Object.is(value, -0) ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
}

const declaration = (type: TypeNode<C, unknown>, name: string, emit: Parameters<Handler>[1]): string => `${emit.node(type).text} ${name}`

/** C source text; integers are spelled as `<stdint.h>` fixed-width types */
export const cTarget = defineTarget(
  { valid: (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name), reserved: new Set([...KEYWORDS, ...STDINT]) },
  {
    "int-type": (node: IntTypeNode) => intName(node),
    "double-type": () => "double",
    "void-type": () => "void",
    "pointer-type": (node: PointerTypeNode, emit) => `${emit.node(node.to).text}*`,
    literal: (node: LiteralNode) =>
      node.type.kind === "int-type" ? intLiteral(node.type as unknown as IntTypeNode, node.value) : doubleLiteral(node.value),
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
