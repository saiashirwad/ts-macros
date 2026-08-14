import type { BindingDeclaration } from "../binding.ts"
import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Program } from "../program.ts"
import type { Block, IfClause } from "../statement.ts"
import type * as Type from "../types/index.ts"
import { collectImports } from "./program.ts"
import { at, braces, frag, type Fragment } from "./render.ts"
import { type Emit, makeEmit, type Target } from "./target.ts"

type TextEmit = Emit<Fragment, string, Fragment>

const IDENT = /^[A-Za-z_$][\w$]*$/

const ident = (name: string, context: string): string => {
  if (!IDENT.test(name)) {
    throw new Error(`Cannot emit invalid identifier "${name}" (in ${context})`)
  }
  return name
}

// JavaScript expression precedence, sparse
const ASSIGN = 2
const ARROW = 2
const COND = 3
const UNARY = 15
const POSTFIX = 17
const PRIMARY = 20

const BINARY: { readonly [Op in Expr.BinaryOperator]: number } = {
  "||": 4,
  "&&": 5,
  "===": 9,
  "!==": 9,
  "<": 10,
  "<=": 10,
  ">": 10,
  ">=": 10,
  "+": 12,
  "-": 12,
  "*": 13,
  "/": 13,
}

const T_LOW = 1
const T_UNION = 2
const T_INTERSECTION = 3
const T_OPERATOR = 4
const T_POSTFIX = 5
const T_PRIMARY = 6

const templateText = (parts: readonly string[], exprs: readonly string[]): string =>
  `\`${parts.map((part, index) => (index === 0 ? part : `\${${exprs[index - 1]!}}${part}`)).join("")}\``

const param = (emit: TextEmit, node: Fn.AnyParam): string => {
  const name = ident(node.name, `param "${node.name}"`)
  const type = at(emit.type(node.type), 0)
  switch (node.kind) {
    case "rest":
      return `...${name}: ${type}`
    case "optional":
      return `${name}?: ${type}`
    default:
      return `${name}: ${type}`
  }
}

const typeParams = (emit: TextEmit, params: Type.AnyParams): string =>
  params.length === 0
    ? ""
    : `<${params.map((p) => (p.extends === undefined ? p.name : `${p.name} extends ${at(emit.type(p.extends), 0)}`)).join(", ")}>`

const blockText = (emit: TextEmit, block: Block): string => braces(emit.block(block))

const ifChain = (emit: TextEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null): string => {
  const chain = clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(emit, clause.body)}`)
    .join(" ")
  return elseBlock === null ? chain : `${chain} else ${blockText(emit, elseBlock)}`
}

const field = (emit: TextEmit, key: string, value: Type.TypeExpr<any>): string => {
  let readonly = false
  let optional = false
  let current = value as Type.Any
  while (current.tag === "readonly-field" || current.tag === "optional-field") {
    if (current.tag === "readonly-field") readonly = true
    if (current.tag === "optional-field") optional = true
    current = current.field as Type.Any
  }
  return `${readonly ? "readonly " : ""}${ident(key, "object type field")}${optional ? "?" : ""}: ${at(emit.type(current), 0)}`
}

export const text: Target<Fragment, string, Fragment> = {
  expr: {
    literal: (node) => frag(PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "var-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}.${ident(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `[${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}]`),
    object: (node, emit) =>
      frag(
        PRIMARY,
        Object.entries(node.fields).length === 0
          ? "{}"
          : `{ ${Object.entries(node.fields).map(([key, value]) => `${ident(key, "object field")}: ${emit.expr(value).text}`).join(", ")} }`,
      ),
    "call-expr": (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: (node, emit) =>
      frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}<${node.typeArgs.map((arg) => at(emit.type(arg), 0)).join(", ")}>`),
    arrow: (node, emit) => frag(ARROW, `(${node.params.map((p) => param(emit, p)).join(", ")}) => ${blockText(emit, node.body)}`),
    binary: (node, emit) => {
      const prec = BINARY[node.op]
      return frag(prec, `${at(emit.expr(node.left), prec)} ${node.op} ${at(emit.expr(node.right), prec + 1)}`)
    },
    unary: (node, emit) => frag(UNARY, `${node.op === "typeof" ? "typeof " : node.op}${at(emit.expr(node.operand), UNARY)}`),
    template: (node, emit) => frag(PRIMARY, templateText(node.parts, node.exprs.map((e) => emit.expr(e).text))),
    cond: (node, emit) =>
      frag(
        COND,
        `${at(emit.expr(node.condition), COND + 1)} ? ${at(emit.expr(node.then), COND)} : ${at(emit.expr(node.else), COND)}`,
      ),
    assign: (node, emit) => frag(ASSIGN, `${at(emit.expr(node.target), POSTFIX)} = ${at(emit.expr(node.value), ASSIGN)}`),
  },
  statement: {
    binding: (node, emit) => bindingDeclaration(node, emit),
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit function ${node.name} without an implementation`)
      }
      const name = ident(node.name, "function-declaration")
      const params = node.params.map((p: Fn.AnyParam) => param(emit, p)).join(", ")
      const returns = node.returnType === undefined ? "" : `: ${at(emit.type(node.returnType), 0)}`
      return `function ${name}${typeParams(emit, node.typeParams)}(${params})${returns} ${blockText(emit, node.body)}`
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      return `type ${ident(node.name, "type-declaration")}${typeParams(emit, node.params)} = ${at(emit.type(node.body), 0)};`
    },
    return: (node, emit) => `return ${emit.expr(node.value).text};`,
    throw: (node, emit) => `throw ${emit.expr(node.value).text};`,
    "expr-statement": (node, emit) => {
      const rendered = emit.expr(node.expr).text
      return `${rendered.startsWith("{") ? `(${rendered})` : rendered};`
    },
    assign: (node, emit) => `${emit.expr(node).text};`,
    break: () => "break;",
    continue: () => "continue;",
    if: (node, emit) => ifChain(emit, node.clauses, node.else),
    while: (node, emit) => `while (${emit.expr(node.condition).text}) ${blockText(emit, node.body)}`,
    "for-of": (node, emit) => `for (const ${ident(node.name, "for-of")} of ${emit.expr(node.iterable).text}) ${blockText(emit, node.body)}`,
  },
  type: {
    primitive: (node) => frag(T_PRIMARY, node.name),
    literal: (node) => frag(T_PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    param: (node) => frag(T_PRIMARY, node.name),
    "infer-var": (node) => frag(T_LOW, `infer ${node.name}`),
    object: (node, emit) => {
      const fields = Object.entries(node.fields).map(([key, value]) => field(emit, key, value))
      return frag(T_PRIMARY, fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`)
    },
    union: (node, emit) => frag(T_UNION, node.members.map((member: Type.TypeExpr<any>) => at(emit.type(member), T_UNION)).join(" | ")),
    intersection: (node, emit) => frag(T_INTERSECTION, node.members.map((member) => at(emit.type(member), T_INTERSECTION)).join(" & ")),
    array: (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.element), T_PRIMARY)}[]`),
    tuple: (node, emit) => frag(T_PRIMARY, `[${node.items.map((item) => at(emit.type(item), 0)).join(", ")}]`),
    function: (node, emit) => {
      const params = node.params.map((p, index) => `arg${index}: ${at(emit.type(p), 0)}`)
      if (node.rest !== undefined) params.push(`...arg${node.params.length}: ${at(emit.type(node.rest), 0)}`)
      return frag(T_LOW, `(${params.join(", ")}) => ${at(emit.type(node.return), 0)}`)
    },
    "indexed-access": (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.object), T_POSTFIX)}[${at(emit.type(node.key), 0)}]`),
    keyof: (node, emit) => frag(T_OPERATOR, `keyof ${at(emit.type(node.operand), T_OPERATOR)}`),
    conditional: (node, emit) =>
      frag(
        T_LOW,
        `${at(emit.type(node.check), T_UNION)} extends ${at(emit.type(node.extends), T_UNION)} ? ${at(emit.type(node.then), T_LOW)} : ${
          at(emit.type(node.else), T_LOW)
        }`,
      ),
    mapped: (node, emit) => frag(T_PRIMARY, `{ [${node.key} in keyof ${at(emit.type(node.source), T_OPERATOR)}]: ${at(emit.type(node.body), 0)} }`),
    "template-literal": (node, emit) => frag(T_PRIMARY, templateText(node.parts, node.exprs.map((e) => at(emit.type(e), 0)))),
    "readonly-field": (node) => {
      throw new Error(`"${node.tag}" is a field modifier and only valid inside object types`)
    },
    "optional-field": (node) => {
      throw new Error(`"${node.tag}" is a field modifier and only valid inside object types`)
    },
    "type-ref": (node, emit) =>
      frag(
        T_PRIMARY,
        node.args !== undefined && node.args.length > 0
          ? `${ident(node.name, "type-ref")}<${node.args.map((arg) => at(emit.type(arg), 0)).join(", ")}>`
          : ident(node.name, "type-ref"),
      ),
    application: (node, emit) => {
      const callee = node.callee as Type.Any
      if (callee.tag !== "type-ref") {
        throw new Error(`cannot emit a type application whose callee is "${callee.tag}" (expected "type-ref")`)
      }
      return frag(T_PRIMARY, `${ident(callee.name, "type application")}<${node.args.map((arg) => at(emit.type(arg), 0)).join(", ")}>`)
    },
  },
}

const bindingDeclaration = (node: BindingDeclaration, emit: TextEmit): string => {
  const annotation = node.annotation === undefined ? "" : `: ${at(emit.type(node.annotation), 0)}`
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${node.kind} ${ident(node.name, node.tag)}${annotation}${init};`
}

const emit: TextEmit = makeEmit(text)

export const exprToText = (node: Expr.Expr<any>): string => emit.expr(node).text

export const statementToText = emit.statement

export const typeExprToText = (node: Type.TypeExpr<any>): string => emit.type(node).text

export const emitProgramText = (program: Program<unknown>): string =>
  [
    ...collectImports(program.statements).map(({ local, source }) => `import * as ${local} from ${JSON.stringify(source)};`),
    ...program.statements.map(emit.statement),
  ].join("\n")
