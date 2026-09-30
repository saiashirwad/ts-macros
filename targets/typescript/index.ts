import type { Block } from "../../src/block.ts"
import type { BindingDeclaration } from "../../src/declaration.ts"
import { collectImports } from "../../src/emit/imports.ts"
import { type Emit, makeEmit, type Target } from "../../src/emit/target.ts"
import type * as Expr from "../../src/expr.ts"
import type { Program } from "../../src/program.ts"
import { bindingNames } from "../../src/scope.ts"
import type { IfStatement, Statement } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

const NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

// reserved in a module, which is always strict
const RESERVED: ReadonlySet<string> = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum export extends false finally for function if "
    + "implements import in instanceof interface let new null package private protected public return static super switch this throw "
    + "true try typeof var void while with yield"
  ).split(" "),
)

// identifiers

/** a name in binding position: a variable, function, param, import, or type */
const identifier = (name: string, context: string): string => {
  if (!NAME.test(name) || RESERVED.has(name)) throw new Error(`cannot emit invalid identifier "${name}" (in ${context})`)
  return name
}

/** a name after `.` or before `:`, where a reserved word is fine (`module.default`) */
const propertyName = (name: string, context: string): string => {
  if (!NAME.test(name)) throw new Error(`cannot emit invalid property name "${name}" (in ${context})`)
  return name
}

/** the source text of a template part; parts hold the string the template produces, as `Expr.String` does */
const templateRaw = (part: string): string => part.replace(/\\|`|\$\{/g, (match) => `\\${match}`)

// fragments

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

// JavaScript expression precedence, sparse
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

const numberExpression = (value: number): Fragment => {
  if (Object.is(value, -0)) return frag(UNARY - 1, "-0")
  if (Number.isNaN(value)) return frag(BINARY["/"], "0 / 0")
  if (value === Infinity) return frag(BINARY["/"], "1 / 0")
  if (value === -Infinity) return frag(BINARY["/"], "-1 / 0")
  return frag(value < 0 ? UNARY - 1 : UNARY, String(value))
}

// type precedence
const T_LOW = 1
const T_UNION = 2
const T_INTERSECTION = 3
const T_OPERATOR = 4
const T_POSTFIX = 5
const T_PRIMARY = 6

// helpers take `(node, emit)`, like the handlers that call them

const templateText = (parts: readonly string[], exprs: readonly string[]): string =>
  `\`${parts.map((part, index) => (index === 0 ? templateRaw(part) : `\${${exprs[index - 1]!}}${templateRaw(part)}`)).join("")}\``

const param = (node: Expr.AnyParam, emit: TextEmit): string => {
  const name = identifier(emit.bindingName(node.id, node.nameHint), `param "${node.nameHint}"`)
  switch (node.form) {
    case "required":
      return `${name}: ${emit.type(node.type).text}`
    case "optional":
      return `${name}?: ${emit.type(node.type).text}`
    case "rest":
      return `...${name}: ${emit.type(Type.array(node.type)).text}`
  }
}

const typeParams = (params: Type.AnyParams, emit: TextEmit): string =>
  params.length === 0
    ? ""
    : `<${params.map((p) => (p.extends === undefined ? p.name : `${p.name} extends ${emit.type(p.extends).text}`)).join(", ")}>`

const blockText = (block: Block<Statement<"built">>, emit: TextEmit): string => braces(emit.block(block))

const ifChain = (node: IfStatement<"built">, emit: TextEmit): string => {
  const chain = node.clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(clause.body, emit)}`)
    .join(" ")
  return node.else === undefined ? chain : `${chain} else ${blockText(node.else, emit)}`
}

const field = (key: string, value: Type.Type<any> | Type.Field, emit: TextEmit): string => {
  const { readonly, optional, type } = Type.fieldOf(value)
  return `${readonly ? "readonly " : ""}${propertyName(key, "object type field")}${optional ? "?" : ""}: ${emit.type(type).text}`
}

/** a declared alias or a host type, applied to its arguments */
const namedType = (node: Type.TypeRef | Type.External, emit: TextEmit): Fragment => {
  const name = identifier(node.kind === "type-ref" ? emit.bindingName(node.id, node.nameHint) : node.name, node.kind)
  return frag(T_PRIMARY, node.args.length === 0 ? name : `${name}<${node.args.map((arg) => emit.type(arg).text).join(", ")}>`)
}

const bindingDeclaration = (node: BindingDeclaration, emit: TextEmit): string => {
  const keyword = node.kind === "let-declaration" ? "let" : "const"
  const annotation = node.annotation === undefined ? "" : `: ${emit.type(node.annotation).text}`
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${keyword} ${identifier(emit.bindingName(node.id, node.nameHint), node.kind)}${annotation}${init};`
}

export const typescript: Target<Fragment, string, Fragment> = {
  expr: {
    // a number is not PRIMARY: `1.toFixed()` does not parse and `-1` is a unary expression
    literal: (node) => (typeof node.value === "number" ? numberExpression(node.value) : frag(PRIMARY, JSON.stringify(node.value))),
    ref: (node, emit) => frag(PRIMARY, identifier(emit.bindingName(node.id, node.nameHint), node.kind)),
    external: (node) => frag(PRIMARY, identifier(node.name, node.kind)),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}.${propertyName(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `[${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}]`),
    object: (node, emit) => {
      const fields = Object.entries(node.fields).map(([key, value]) => `${propertyName(key, "object field")}: ${emit.expr(value).text}`)
      return frag(PRIMARY, fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`)
    },
    call: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: (node, emit) =>
      frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}<${node.typeArgs.map((arg) => emit.type(arg).text).join(", ")}>`),
    arrow: (node, emit) => frag(ARROW, `(${node.params.map((p) => param(p, emit)).join(", ")}) => ${blockText(node.body, emit)}`),
    binary: (node, emit) => {
      const prec = BINARY[node.op]
      return frag(prec, `${at(emit.expr(node.left), prec)} ${node.op} ${at(emit.expr(node.right), prec + 1)}`)
    },
    unary: (node, emit) => frag(UNARY, `${node.op === "typeof" ? "typeof " : node.op}${at(emit.expr(node.operand), UNARY)}`),
    template: (node, emit) => frag(PRIMARY, templateText(node.parts, node.exprs.map((e) => emit.expr(e).text))),
    cond: (node, emit) =>
      frag(COND, `${at(emit.expr(node.condition), COND + 1)} ? ${at(emit.expr(node.then), COND)} : ${at(emit.expr(node.else), COND)}`),
  },
  statement: {
    "let-declaration": bindingDeclaration,
    "const-declaration": bindingDeclaration,
    "function-declaration": (node, emit) => {
      const name = identifier(emit.bindingName(node.id, node.nameHint), node.kind)
      const params = node.params.map((p: Expr.AnyParam) => param(p, emit)).join(", ")
      const returns = node.returnType === undefined ? "" : `: ${emit.type(node.returnType).text}`
      return `function ${name}${typeParams(node.typeParams, emit)}(${params})${returns} ${blockText(node.body, emit)}`
    },
    "type-declaration": (node, emit) =>
      `type ${identifier(emit.bindingName(node.id, node.nameHint), node.kind)}${typeParams(node.params, emit)} = ${emit.type(node.body).text};`,
    return: (node, emit) => `return ${emit.expr(node.value).text};`,
    throw: (node, emit) => `throw ${emit.expr(node.value).text};`,
    "expr-statement": (node, emit) => {
      const rendered = emit.expr(node.expr).text
      return `${rendered.startsWith("{") ? `(${rendered})` : rendered};`
    },
    assign: (node, emit) => `${at(emit.expr(node.target), POSTFIX)} = ${emit.expr(node.value).text};`,
    break: () => "break;",
    continue: () => "continue;",
    if: ifChain,
    while: (node, emit) => `while (${emit.expr(node.condition).text}) ${blockText(node.body, emit)}`,
    "for-of": (node, emit) =>
      `for (const ${identifier(emit.bindingName(node.id, node.nameHint), node.kind)} of ${emit.expr(node.iterable).text}) ${
        blockText(node.body, emit)
      }`,
  },
  type: {
    primitive: (node) => frag(T_PRIMARY, node.name),
    literal: (node) => frag(T_PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "template-literal": (node, emit) => frag(T_PRIMARY, templateText(node.parts, node.exprs.map((e) => emit.type(e).text))),
    param: (node) => frag(T_PRIMARY, identifier(node.name, "type param")),
    "infer-var": (node) => frag(T_LOW, `infer ${identifier(node.name, node.kind)}`),
    object: (node, emit) => {
      const fields = Object.entries(node.fields).map(([key, value]) => field(key, value, emit))
      return frag(T_PRIMARY, fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`)
    },
    union: (node, emit) => frag(T_UNION, node.members.map((member: Type.Type<any>) => at(emit.type(member), T_UNION)).join(" | ")),
    intersection: (node, emit) =>
      frag(T_INTERSECTION, node.members.map((member: Type.Type<any>) => at(emit.type(member), T_INTERSECTION)).join(" & ")),
    array: (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.element), T_PRIMARY)}[]`),
    tuple: (node, emit) => frag(T_PRIMARY, `[${node.items.map((item) => emit.type(item).text).join(", ")}]`),
    function: (node, emit) => {
      const params = node.params.map((p, index) => `arg${index}: ${emit.type(p).text}`)
      if (node.rest !== undefined) params.push(`...arg${node.params.length}: ${emit.type(node.rest).text}`)
      return frag(T_LOW, `(${params.join(", ")}) => ${emit.type(node.return).text}`)
    },
    "indexed-access": (node, emit) => frag(T_POSTFIX, `${at(emit.type(node.object), T_POSTFIX)}[${emit.type(node.key).text}]`),
    keyof: (node, emit) => frag(T_OPERATOR, `keyof ${at(emit.type(node.operand), T_OPERATOR)}`),
    logical: (node, emit) => frag(T_LOW, `(${emit.type(node.left).text}) ${node.op === "and" ? "&" : "|"} (${emit.type(node.right).text})`),
    conditional: (node, emit) =>
      frag(
        T_LOW,
        `${at(emit.type(node.check), T_UNION)} extends ${at(emit.type(node.extends), T_UNION)} ? ${at(emit.type(node.then), T_LOW)} : ${
          at(emit.type(node.else), T_LOW)
        }`,
      ),
    mapped: (node, emit) =>
      frag(
        T_PRIMARY,
        `{ [${identifier(node.key, "mapped type key")} in keyof ${at(emit.type(node.source), T_OPERATOR)}]: ${emit.type(node.body).text} }`,
      ),
    "type-ref": namedType,
    external: namedType,
  },
}

export const emitProgram = (program: Program<unknown>): string => {
  const emit = makeEmit(typescript, bindingNames(program.statements))
  return [
    ...collectImports(program.statements).map(({ local, source }) =>
      `import * as ${identifier(local, `import from "${source}"`)} from ${JSON.stringify(source)};`
    ),
    ...program.statements.map(emit.statement),
  ].join("\n")
}
