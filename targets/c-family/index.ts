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
import type { BindingId } from "../../src/identity.ts"
import type { Block, IfClause, Statement } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"
import { walk } from "../../src/walk.ts"

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

export const C_NOMINALS = {
  Int: "int",
  F32: "float",
  U32: "uint32_t",
  I32: "int32_t",
  U64: "uint64_t",
  I64: "int64_t",
  F64: "double",
  Size: "size_t",
} satisfies Record<string, string>

export const BINARY = {
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
  "%": { spelling: "%", prec: 13 },
} satisfies { readonly [Op in Expr.BinaryOperator]: { readonly spelling: string; readonly prec: number } }

export const declare = (type: string, name: string): string => (type.endsWith("*") ? `${type}${name}` : `${type} ${name}`)

export const param = (emit: CEmit, node: Fn.AnyParam, fail: (what: string) => never): string => {
  if (node.kind === "rest") return fail("no rest parameters")
  if (node.kind === "optional") return fail("no optional parameters")
  return declare(emit.type(node.type), ident(emit.bindingName(node.id, node.nameHint), `param "${node.nameHint}"`))
}

export const blockText = (emit: CEmit, block: Block): string => braces(emit.block(block))

export const ifChain = (emit: CEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null): string => {
  const chain = clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(emit, clause.body)}`)
    .join(" ")
  return elseBlock === null ? chain : `${chain} else ${blockText(emit, elseBlock)}`
}

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

export const arrayType = (node: Type.ArrayType<any>, emit: CEmit): string => {
  const element = emit.type(node.element)
  return element.endsWith("*") ? `${element}*` : `${element} *`
}

declare const OwnedId: unique symbol

interface OwnedBrand<Free extends string> {
  readonly [OwnedId]?: Free
}

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
  return node.tag === "type-ref" && node.name === "Owned" && (node.args?.length === 1 || node.args?.length === 2)
}

export const ownedFlavor = (type: Type.TypeExpr<any>): string => {
  const node = type as Type.Any
  if (node.tag !== "type-ref" || node.name !== "Owned" || node.args?.length !== 2) return "free"
  const flavor = (node.args[1] as Type.Literal).value
  return typeof flavor === "string" ? flavor : "free"
}

export const int = (): Type.TypeExpr<number> => Type.Nominal<number>("Int", Type.Number())
export const f32 = (): Type.TypeExpr<number> => Type.Nominal<number>("F32", Type.Number())

export const scalarOracle = (user: TypeOracle | undefined): TypeOracle => ({
  externalRef: (node) => user?.externalRef?.(node) ?? null,
  typeRef: (node) => node.erasesTo ?? user?.typeRef?.(node) ?? null,
})

export const synthesizedReturn = (types: Synthesis, node: Fn.FunctionDeclaration<any, any, any>): Type.TypeExpr<any> | null => {
  const signature = types.typeOfFunction(node) as Type.Any | null
  return signature !== null && signature.tag === "function" ? signature.return : null
}

export const signatureOf = (
  node: Fn.FunctionDeclaration<any, any, any>,
  emit: CEmit,
  types: Synthesis,
  fail: (what: string) => never,
  spellReturn: (returnType: Type.TypeExpr<any>) => string = (returnType) => emit.type(widen(returnType)),
): string => {
  if (node.body === undefined) {
    throw new Error(`Cannot emit function ${node.nameHint} without an implementation`)
  }
  if (node.typeParams.length > 0) return fail("no generic functions")
  const returnType = node.returnType ?? synthesizedReturn(types, node)
  if (returnType === null) {
    return fail(`cannot infer a C type for function "${node.nameHint}" — annotate its return type`)
  }
  const params = node.params.map((p: Fn.AnyParam) => param(emit, p, fail)).join(", ")
  const name = ident(emit.bindingName(node.id, node.nameHint), "function-declaration")
  return `${declare(spellReturn(returnType), name)}(${params.length === 0 ? "void" : params})`
}

export const calleeBinding = (node: unknown): BindingId | undefined => {
  const n = node as { readonly tag?: string; readonly callee?: { readonly tag?: string; readonly target?: BindingId } }
  if (n?.tag !== "call-expr") return undefined
  const tag = n.callee?.tag
  return tag === "var-ref" || tag === "function-ref" || tag === "generic-function-ref" ? n.callee?.target : undefined
}

export const calledBeforeDeclaration = (statements: ReadonlyArray<Statement>): ReadonlySet<BindingId> => {
  const declared = new Map<BindingId, number>()
  statements.forEach((statement, index) => {
    if (statement.tag === "function-declaration" && statement.body !== undefined && !declared.has(statement.id)) {
      declared.set(statement.id, index)
    }
  })
  const hoisted = new Set<BindingId>()
  statements.forEach((statement, index) => {
    walk(statement, (node) => {
      const binding = calleeBinding(node)
      if (binding === undefined) return
      const declaredAt = declared.get(binding)
      if (declaredAt !== undefined && index < declaredAt) hoisted.add(binding)
    })
  })
  return hoisted
}

export const bindingDeclaration = (node: BindingDeclaration, emit: CEmit, types: Synthesis, fail: (what: string) => never): string => {
  const inferred = node.annotation ?? (node.expr === undefined ? null : types.tryTypeOf(node.expr))
  if (inferred === null) return fail(`cannot infer a C type for "${node.nameHint}" — annotate it`)
  const type = emit.type(widen(inferred))
  const qualified = node.tag === "const-declaration" && !isOwnedType(inferred) && !type.startsWith("const ") ? `const ${type}` : type
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${declare(qualified, ident(emit.bindingName(node.id, node.nameHint), node.tag))}${init};`
}

export interface CFamilyBase {
  readonly expr: Target<Fragment, string, string>["expr"]
  readonly statement: Omit<StatementHandlers<Fragment, string, string>, "let-declaration" | "const-declaration" | "function-declaration">
  readonly type: Omit<TypeHandlers<Fragment, string, string>, "type-ref">
}

const INTEGER_NOMINALS = new Set(["Int", "U32", "I32", "U64", "I64"])

const isIntegerType = (type: Type.TypeExpr<any> | null): boolean => {
  const node = type as Type.Any | null
  return node?.tag === "type-ref" && INTEGER_NOMINALS.has(node.name)
}

export const cFamily = (fail: (what: string) => never, types?: Synthesis): CFamilyBase => ({
  expr: {
    literal: (node) => frag(PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "external-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    "var-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    "function-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    "generic-function-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}->${ident(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `{${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}}`),
    object: () => fail("an object literal needs a struct type"),
    "call-expr": (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: () => fail("no generic instantiation"),
    arrow: () => fail("no closures"),
    binary: (node, emit) => {
      const { spelling, prec } = BINARY[node.op]
      const leftType = types?.tryTypeOf(node.left) ?? null
      const rightType = types?.tryTypeOf(node.right) ?? null
      if (node.op === "%" && (!isIntegerType(leftType) || !isIntegerType(rightType))) {
        return fail("% requires integer operands")
      }
      const floatingDivision = node.op === "/" && !(isIntegerType(leftType) && isIntegerType(rightType))
      const operand = (expr: Expr.Expr<any>, at_: number): string => {
        const rendered = at(emit.expr(expr), at_)
        return floatingDivision ? `(double)(${rendered})` : rendered
      }
      return frag(prec, `${operand(node.left, prec)} ${spelling} ${operand(node.right, prec + 1)}`)
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
    tuple: () => fail("no tuple types"),
    function: () => fail("no function types"),
    application: () => fail("no generic types"),
  },
})
