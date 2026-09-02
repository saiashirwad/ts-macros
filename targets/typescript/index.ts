import type { BindingDeclaration } from "../../src/binding.ts"
import { collectImports } from "../../src/emit/imports.ts"
import { type Emit, makeEmit, type Target } from "../../src/emit/target.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import type { Program } from "../../src/program.ts"
import { bindingNames } from "../../src/scope.ts"
import type { Block, IfClause } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

/** emitted text with the precedence of its outermost operator, so parents know when to parenthesize */
interface Fragment {
  readonly prec: number
  readonly text: string
}

const frag = (prec: number, text: string): Fragment => ({ prec, text })

const at = (fragment: Fragment, min: number): string => (fragment.prec >= min ? fragment.text : `(${fragment.text})`)

const braces = (lines: readonly string[]): string =>
  lines.length === 0 ? "{}" : `{\n${lines.flatMap((line) => line.split("\n")).map((line) => (line === "" ? line : `  ${line}`)).join("\n")}\n}`

type TextEmit = Emit<Fragment, string, Fragment>

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

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

const BINARY = {
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
  "%": 13,
} satisfies { readonly [Op in Expr.BinaryOperator]: number }

// type precedence
const T_LOW = 1
const T_UNION = 2
const T_INTERSECTION = 3
const T_OPERATOR = 4
const T_POSTFIX = 5
const T_PRIMARY = 6

const templateText = (parts: readonly string[], exprs: readonly string[]): string =>
  `\`${parts.map((part, index) => (index === 0 ? part : `\${${exprs[index - 1]!}}${part}`)).join("")}\``

const param = (emit: TextEmit, node: Fn.AnyParam): string => {
  const name = ident(emit.bindingName(node.id, node.nameHint), `param "${node.nameHint}"`)
  const type = emit.type(node.type).text
  switch (node.kind) {
    // a rest param is declared by its element type
    case "rest":
      return `...${name}: ${emit.type(Type.Array(node.type)).text}`
    case "optional":
      return `${name}?: ${type}`
    default:
      return `${name}: ${type}`
  }
}

const typeParams = (emit: TextEmit, params: Type.AnyParams): string =>
  params.length === 0
    ? ""
    : `<${params.map((p) => (p.extends === undefined ? p.name : `${p.name} extends ${emit.type(p.extends).text}`)).join(", ")}>`

const blockText = (emit: TextEmit, block: Block): string => braces(emit.block(block))

const ifChain = (emit: TextEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null): string => {
  const chain = clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(emit, clause.body)}`)
    .join(" ")
  return elseBlock === null ? chain : `${chain} else ${blockText(emit, elseBlock)}`
}

/** an object type field, unwrapping `Readonly`/`Optional` modifiers into their keywords */
const field = (emit: TextEmit, key: string, value: Type.TypeExpr<any>): string => {
  let readonly = false
  let optional = false
  let current = value as Type.Any
  while (current.tag === "readonly-field" || current.tag === "optional-field") {
    if (current.tag === "readonly-field") readonly = true
    else optional = true
    current = current.field as Type.Any
  }
  return `${readonly ? "readonly " : ""}${ident(key, "object type field")}${optional ? "?" : ""}: ${emit.type(current).text}`
}

const fieldModifier = (node: Type.ReadonlyField | Type.OptionalField): never => {
  throw new Error(`"${node.tag}" is a field modifier and only valid inside an object type`)
}

const bindingDeclaration = (node: BindingDeclaration, emit: TextEmit): string => {
  const kind = node.tag === "let-declaration" ? "let" : "const"
  const annotation = node.annotation === undefined ? "" : `: ${emit.type(node.annotation).text}`
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${kind} ${ident(emit.bindingName(node.id, node.nameHint), node.tag)}${annotation}${init};`
}

export const typescript: Target<Fragment, string, Fragment> = {
  expr: {
    literal: (node) => frag(PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "external-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    "var-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    "function-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    "generic-function-ref": (node, emit) => frag(PRIMARY, ident(emit.bindingName(node.target, node.nameHint), node.tag)),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}.${ident(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `[${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}]`),
    object: (node, emit) => {
      const fields = Object.entries(node.fields).map(([key, value]) => `${ident(key, "object field")}: ${emit.expr(value).text}`)
      return frag(PRIMARY, fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`)
    },
    "call-expr": (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: (node, emit) =>
      frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}<${node.typeArgs.map((arg) => emit.type(arg).text).join(", ")}>`),
    arrow: (node, emit) => frag(ARROW, `(${node.params.map((p) => param(emit, p)).join(", ")}) => ${blockText(emit, node.body)}`),
    binary: (node, emit) => {
      const prec = BINARY[node.op]
      return frag(prec, `${at(emit.expr(node.left), prec)} ${node.op} ${at(emit.expr(node.right), prec + 1)}`)
    },
    unary: (node, emit) => frag(UNARY, `${node.op === "typeof" ? "typeof " : node.op}${at(emit.expr(node.operand), UNARY)}`),
    template: (node, emit) => frag(PRIMARY, templateText(node.parts, node.exprs.map((e) => emit.expr(e).text))),
    cond: (node, emit) =>
      frag(COND, `${at(emit.expr(node.condition), COND + 1)} ? ${at(emit.expr(node.then), COND)} : ${at(emit.expr(node.else), COND)}`),
    assign: (node, emit) => frag(ASSIGN, `${at(emit.expr(node.target), POSTFIX)} = ${at(emit.expr(node.value), ASSIGN)}`),
  },
  statement: {
    "let-declaration": bindingDeclaration,
    "const-declaration": bindingDeclaration,
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit function ${node.nameHint} without an implementation`)
      }
      const name = ident(emit.bindingName(node.id, node.nameHint), "function-declaration")
      const params = node.params.map((p: Fn.AnyParam) => param(emit, p)).join(", ")
      const returns = node.returnType === undefined ? "" : `: ${emit.type(node.returnType).text}`
      return `function ${name}${typeParams(emit, node.typeParams)}(${params})${returns} ${blockText(emit, node.body)}`
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      return `type ${ident(node.name, "type-declaration")}${typeParams(emit, node.params)} = ${emit.type(node.body).text};`
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
    "for-of": (node, emit) =>
      `for (const ${ident(emit.bindingName(node.id, node.nameHint), "for-of")} of ${emit.expr(node.iterable).text}) ${blockText(emit, node.body)}`,
  },
  type: {
    primitive: (node) => frag(T_PRIMARY, node.name),
    literal: (node) => frag(T_PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "template-literal": (node, emit) => frag(T_PRIMARY, templateText(node.parts, node.exprs.map((e) => emit.type(e).text))),
    param: (node) => frag(T_PRIMARY, node.name),
    "infer-var": (node) => frag(T_LOW, `infer ${node.name}`),
    object: (node, emit) => {
      const fields = Object.entries(node.fields).map(([key, value]) => field(emit, key, value))
      return frag(T_PRIMARY, fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`)
    },
    "readonly-field": fieldModifier,
    "optional-field": fieldModifier,
    union: (node, emit) => frag(T_UNION, node.members.map((member: Type.TypeExpr<any>) => at(emit.type(member), T_UNION)).join(" | ")),
    intersection: (node, emit) =>
      frag(T_INTERSECTION, node.members.map((member: Type.TypeExpr<any>) => at(emit.type(member), T_INTERSECTION)).join(" & ")),
    array: (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.element), T_PRIMARY)}[]`),
    tuple: (node, emit) => frag(T_PRIMARY, `[${node.items.map((item) => emit.type(item).text).join(", ")}]`),
    function: (node, emit) => {
      const params = node.params.map((p, index) => `arg${index}: ${emit.type(p).text}`)
      if (node.rest !== undefined) params.push(`...arg${node.params.length}: ${emit.type(node.rest).text}`)
      return frag(T_LOW, `(${params.join(", ")}) => ${emit.type(node.return).text}`)
    },
    "indexed-access": (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.object), T_POSTFIX)}[${emit.type(node.key).text}]`),
    keyof: (node, emit) => frag(T_OPERATOR, `keyof ${at(emit.type(node.operand), T_OPERATOR)}`),
    conditional: (node, emit) =>
      frag(
        T_LOW,
        `${at(emit.type(node.check), T_UNION)} extends ${at(emit.type(node.extends), T_UNION)} ? ${at(emit.type(node.then), T_LOW)} : ${
          at(emit.type(node.else), T_LOW)
        }`,
      ),
    mapped: (node, emit) => frag(T_PRIMARY, `{ [${node.key} in keyof ${at(emit.type(node.source), T_OPERATOR)}]: ${emit.type(node.body).text} }`),
    // a nominal type is spelled by what it erases to; this target does not know the name
    "type-ref": (node, emit) =>
      node.erasesTo !== undefined
        ? emit.type(node.erasesTo)
        : frag(
          T_PRIMARY,
          node.args !== undefined && node.args.length > 0
            ? `${ident(node.name, "type-ref")}<${node.args.map((arg) => emit.type(arg).text).join(", ")}>`
            : ident(node.name, "type-ref"),
        ),
  },
}

export const emitProgramTypeScript = (program: Program<unknown>): string => {
  const emit = makeEmit(typescript, bindingNames(program.statements))
  return [
    ...collectImports(program.statements).map(({ local, source }) =>
      `import * as ${ident(local, `import from "${source}"`)} from ${JSON.stringify(source)};`
    ),
    ...program.statements.map(emit.statement),
  ].join("\n")
}
