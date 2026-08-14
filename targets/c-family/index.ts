// shared C-family kit: the mechanical spellings every brace-language target
// (C, CUDA, and friends) needs, minus each language's own policy.
//
// Two layers: cFamily() is a base target with the shared handlers — a target
// spreads it and overrides only its deltas — and the helpers below are the
// pieces those deltas compose from. Extracted from targets/c when the CUDA
// target started copying it.
import type { BindingDeclaration } from "../../src/binding.ts"
import {
  at,
  braces,
  type Emit,
  frag,
  type Fragment,
  type StatementHandlers,
  type Synthesis,
  type Target,
  type TypeHandlers,
  type TypeOracle,
  widen,
} from "../../src/emit/index.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import type { Block, IfClause } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

export type CEmit = Emit<Fragment, string, string>

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

export const ident = (name: string, context: string): string => {
  if (!IDENT.test(name)) {
    throw new Error(`Cannot emit invalid C identifier "${name}" (in ${context})`)
  }
  return name
}

export const UNARY = 15
export const POSTFIX = 17
export const PRIMARY = 20

// C spellings for the operators; === collapses to == by C-family semantics
export const BINARY: { readonly [Op in Expr.BinaryOperator]: { readonly spelling: string; readonly prec: number } } = {
  "||": { spelling: "||", prec: 4 },
  "&&": { spelling: "&&", prec: 5 },
  "===": { spelling: "==", prec: 9 },
  "!==": { spelling: "!=", prec: 9 },
  "<": { spelling: "<", prec: 10 },
  "<=": { spelling: "<=", prec: 10 },
  ">": { spelling: ">", prec: 10 },
  ">=": { spelling: ">=", prec: 10 },
  "+": { spelling: "+", prec: 12 },
  "-": { spelling: "-", prec: 12 },
  "*": { spelling: "*", prec: 13 },
  "/": { spelling: "/", prec: 13 },
}

// a C declarator wraps the name, so types render through declare()
export const declare = (type: string, name: string): string => (type.endsWith("*") ? `${type}${name}` : `${type} ${name}`)

export const param = (emit: CEmit, node: Fn.AnyParam, fail: (what: string) => never): string => {
  if (node.kind === "rest") return fail("no rest parameters")
  if (node.kind === "optional") return fail("no optional parameters")
  return declare(emit.type(node.type), ident(node.name, `param "${node.name}"`))
}

export const blockText = (emit: CEmit, block: Block): string => braces(emit.block(block))

export const ifChain = (emit: CEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null): string => {
  const chain = clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(emit, clause.body)}`)
    .join(" ")
  return elseBlock === null ? chain : `${chain} else ${blockText(emit, elseBlock)}`
}

// the scalar spellings the whole C family shares; targets override when
// their semantics differ (CUDA wants float via f32())
export const primitiveType = (node: Type.Primitive, fail: (what: string) => never): string => {
  switch (node.name) {
    case "number":
      return "double"
    case "boolean":
      return "bool"
    case "string":
      return "const char *"
    case "void":
      return "void"
    default:
      return fail(`no "${node.name}" type`)
  }
}

// T[] spells as T *: C-family arrays decay to pointers
export const arrayType = (node: Type.ArrayType<any>, emit: CEmit): string => {
  const element = emit.type(node.element)
  return element.endsWith("*") ? `${element}*` : `${element} *`
}

// --- the Owned brand -------------------------------------------------------

declare const OwnedId: unique symbol

interface OwnedBrand<Free extends string> {
  readonly [OwnedId]?: Free
}

// the brand marks a value whose storage the program must release; the value
// still behaves as A everywhere else, so props, indexing and calls keep
// their types. The Free param names the release function so one pass can
// manage values from different allocators (free vs cudaFree).
export type Owned<A, Free extends string = "free"> = A & OwnedBrand<Free>

export const owned = <A, const Free extends string = "free">(
  inner: Type.TypeExpr<A>,
  free: Free = "free" as Free,
): Type.TypeExpr<Owned<A, Free>> =>
  free === "free"
    ? Type.Ref<Owned<A, Free>>("Owned", inner)
    : Type.Ref<Owned<A, Free>>("Owned", inner, Type.Literal(free))

export const isOwnedType = (type: Type.TypeExpr<any>): boolean => {
  const node = type as Type.Any
  return node.tag === "type-ref" && node.name === "Owned" && node.args !== undefined
    && (node.args.length === 1 || node.args.length === 2)
}

// the release function an Owned binding names: "free" unless the brand
// carries one (owned(t, "cudaFree"))
export const ownedFlavor = (type: Type.TypeExpr<any>): string => {
  const node = type as { readonly tag?: string; readonly name?: string; readonly args?: readonly Type.TypeExpr<any>[] }
  if (node.tag !== "type-ref" || node.name !== "Owned" || node.args === undefined || node.args.length !== 2) return "free"
  const flavor = (node.args[1] as Type.Literal).value
  return typeof flavor === "string" ? flavor : "free"
}

// a C-family refinement: still a number to TypeScript, spelled int by C
export const int = (): Type.TypeExpr<number> => Type.Ref<number>("Int")

// lets listed nominal refs compute as numbers while bindings stay nominal
export const scalarOracle = (user: TypeOracle | undefined, ...names: string[]): TypeOracle => ({
  varRef: (node) => user?.varRef?.(node) ?? null,
  typeRef: (node) =>
    names.includes(node.name) && (node.args === undefined || node.args.length === 0)
      ? Type.Number()
      : user?.typeRef?.(node) ?? null,
})

export const synthesizedReturn = (types: Synthesis, node: Fn.FunctionDeclaration<any, any, any>): Type.TypeExpr<any> | null => {
  const signature = types.typeOfFunction(node) as Type.Any | null
  return signature !== null && signature.tag === "function" ? signature.return : null
}

export const bindingDeclaration = (node: BindingDeclaration, emit: CEmit, types: Synthesis, fail: (what: string) => never): string => {
  const inferred = node.annotation ?? (node.expr === undefined ? null : types.tryTypeOf(node.expr))
  if (inferred === null) return fail(`cannot infer a C type for "${node.name}" — annotate it`)
  const type = emit.type(widen(inferred))
  const qualified = node.kind === "const" && !isOwnedType(inferred) && !type.startsWith("const ") ? `const ${type}` : type
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${declare(qualified, ident(node.name, node.tag))}${init};`
}

// --- the base target -------------------------------------------------------

// every handler the C family shares, minus the statement kinds and the type
// kind that close over per-target state (the Synthesis for binding and
// function declarations, the nominal-ref policy for type-ref). A target
// spreads this and supplies the deltas; `fail` gives every unsupported
// error its target's prefix.
export interface CFamilyBase {
  readonly expr: Target<Fragment, string, string>["expr"]
  readonly statement: Omit<StatementHandlers<Fragment, string, string>, "binding" | "function-declaration">
  readonly type: Omit<TypeHandlers<Fragment, string, string>, "type-ref">
}

export const cFamily = (fail: (what: string) => never): CFamilyBase => ({
  expr: {
    literal: (node) => frag(PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "var-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}->${ident(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `{${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}}`),
    object: () => fail("an object literal needs a struct type"),
    "call-expr": (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: () => fail("no generic instantiation"),
    arrow: () => fail("no closures"),
    binary: (node, emit) => {
      const { spelling, prec } = BINARY[node.op]
      return frag(prec, `${at(emit.expr(node.left), prec)} ${spelling} ${at(emit.expr(node.right), prec + 1)}`)
    },
    unary: (node, emit) => (node.op === "typeof" ? fail("no typeof") : frag(UNARY, `!${at(emit.expr(node.operand), UNARY)}`)),
    template: () => fail("no template literals"),
    cond: (node, emit) => frag(3, `${at(emit.expr(node.condition), 4)} ? ${at(emit.expr(node.then), 3)} : ${at(emit.expr(node.else), 3)}`),
    assign: (node, emit) => frag(2, `${at(emit.expr(node.target), POSTFIX)} = ${at(emit.expr(node.value), 2)}`),
  },
  statement: {
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      if (node.params.length > 0) return fail("no generic types")
      return `typedef ${declare(emit.type(node.body), ident(node.name, "type-declaration"))};`
    },
    return: (node, emit) => `return ${emit.expr(node.value).text};`,
    throw: () => fail("no exceptions"),
    "expr-statement": (node, emit) => `${emit.expr(node.expr).text};`,
    assign: (node, emit) => `${emit.expr(node).text};`,
    break: () => "break;",
    continue: () => "continue;",
    if: (node, emit) => ifChain(emit, node.clauses, node.else),
    while: (node, emit) => `while (${emit.expr(node.condition).text}) ${blockText(emit, node.body)}`,
    "for-of": () => fail("no for-of; write a while loop over an index"),
  },
  type: {
    primitive: (node) => primitiveType(node, fail),
    array: (node, emit) => arrayType(node, emit),
    literal: () => fail("no literal types"),
    param: () => fail("no type parameters"),
    object: () => fail("declare a struct instead of an object type"),
    union: () => fail("no union types"),
    intersection: () => fail("no intersection types"),
    tuple: () => fail("no tuple types"),
    function: () => fail("no function types"),
    "indexed-access": () => fail("no indexed access types"),
    keyof: () => fail("no keyof"),
    conditional: () => fail("no conditional types"),
    mapped: () => fail("no mapped types"),
    "template-literal": () => fail("no template literal types"),
    "infer-var": () => fail("no infer"),
    "readonly-field": () => fail("no field modifiers"),
    "optional-field": () => fail("no field modifiers"),
    application: () => fail("no generic types"),
  },
})
