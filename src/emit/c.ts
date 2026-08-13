import type { BindingDeclaration } from "../binding.ts"
import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Program } from "../program.ts"
import type { Block, IfClause } from "../statement.ts"
import type * as Type from "../types/index.ts"
import { collectImports } from "./program.ts"
import { at, braces, frag, type Fragment } from "./render.ts"
import { type Synthesis, synthesize, type TypeOracle, widen } from "./synthesize.ts"
import { type Emit, makeEmit, type Target } from "./target.ts"

type CEmit = Emit<Fragment, string, string>

const unsupported = (what: string): never => {
  throw new Error(`c target: ${what}`)
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

const ident = (name: string, context: string): string => {
  if (!IDENT.test(name)) {
    throw new Error(`Cannot emit invalid C identifier "${name}" (in ${context})`)
  }
  return name
}

const UNARY = 15
const POSTFIX = 17
const PRIMARY = 20

const BINARY: { readonly [Op in Expr.BinaryOperator]: { readonly spelling: string; readonly prec: number } } = {
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
const declare = (type: string, name: string): string => (type.endsWith("*") ? `${type}${name}` : `${type} ${name}`)

const param = (emit: CEmit, node: Fn.AnyParam): string => {
  if (node.kind === "rest") return unsupported("no rest parameters")
  if (node.kind === "optional") return unsupported("no optional parameters")
  return declare(emit.type(node.type), ident(node.name, `param "${node.name}"`))
}

const blockText = (emit: CEmit, block: Block): string => braces(emit.block(block))

const ifChain = (emit: CEmit, clauses: ReadonlyArray<IfClause>, elseBlock: Block | null): string => {
  const chain = clauses
    .map((clause, index) => `${index === 0 ? "if" : "else if"} (${emit.expr(clause.condition).text}) ${blockText(emit, clause.body)}`)
    .join(" ")
  return elseBlock === null ? chain : `${chain} else ${blockText(emit, elseBlock)}`
}

export const c = (types: Synthesis): Target<Fragment, string, string> => ({
  expr: {
    literal: (node) => frag(PRIMARY, typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value)),
    "var-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    "function-ref": (node) => frag(PRIMARY, ident(node.name, node.tag)),
    "generic-function-ref": () => unsupported("no generic functions"),
    prop: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}->${ident(node.key, "prop key")}`),
    index: (node, emit) => frag(POSTFIX, `${at(emit.expr(node.object), POSTFIX)}[${emit.expr(node.index).text}]`),
    array: (node, emit) => frag(PRIMARY, `{${node.elements.map((element: Expr.Expr<any>) => emit.expr(element).text).join(", ")}}`),
    object: () => unsupported("an object literal needs a struct type"),
    "call-expr": (node, emit) => frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${node.args.map((arg) => emit.expr(arg).text).join(", ")})`),
    instantiation: () => unsupported("no generic instantiation"),
    arrow: () => unsupported("no closures"),
    binary: (node, emit) => {
      const { spelling, prec } = BINARY[node.op]
      return frag(prec, `${at(emit.expr(node.left), prec)} ${spelling} ${at(emit.expr(node.right), prec + 1)}`)
    },
    unary: (node, emit) => (node.op === "typeof" ? unsupported("no typeof") : frag(UNARY, `!${at(emit.expr(node.operand), UNARY)}`)),
    template: () => unsupported("no template literals"),
    cond: (node, emit) => frag(3, `${at(emit.expr(node.condition), 4)} ? ${at(emit.expr(node.then), 3)} : ${at(emit.expr(node.else), 3)}`),
    assign: (node, emit) => frag(2, `${at(emit.expr(node.target), POSTFIX)} = ${at(emit.expr(node.value), 2)}`),
  },
  statement: {
    "let-declaration": (node, emit) => bindingDeclaration(node, emit, types),
    "const-declaration": (node, emit) => bindingDeclaration(node, emit, types),
    "function-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit function ${node.name} without an implementation`)
      }
      if (node.typeParams.length > 0) return unsupported("no generic functions")
      const returnType = node.returnType ?? synthesizedReturn(types, node)
      if (returnType === null) {
        return unsupported(`cannot infer a C type for function "${node.name}" — annotate its return type`)
      }
      const signature = declare(emit.type(widen(returnType)), ident(node.name, "function-declaration"))
      const params = node.params.map((p: Fn.AnyParam) => param(emit, p)).join(", ")
      return `${signature}(${params.length === 0 ? "void" : params}) ${blockText(emit, node.body)}`
    },
    "type-declaration": (node, emit) => {
      if (node.body === undefined) {
        throw new Error(`Cannot emit type ${node.name} without a body`)
      }
      if (node.params.length > 0) return unsupported("no generic types")
      return `typedef ${declare(emit.type(node.body), ident(node.name, "type-declaration"))};`
    },
    return: (node, emit) => `return ${emit.expr(node.value).text};`,
    throw: () => unsupported("no exceptions"),
    "expr-statement": (node, emit) => `${emit.expr(node.expr).text};`,
    assign: (node, emit) => `${emit.expr(node).text};`,
    break: () => "break;",
    continue: () => "continue;",
    if: (node, emit) => ifChain(emit, node.clauses, node.else),
    while: (node, emit) => `while (${emit.expr(node.condition).text}) ${blockText(emit, node.body)}`,
    "for-of": () => unsupported("no for-of; write a while loop over an index"),
  },
  type: {
    primitive: (node) => {
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
          return unsupported(`no "${node.name}" type`)
      }
    },
    array: (node, emit) => {
      const element = emit.type(node.element)
      return element.endsWith("*") ? `${element}*` : `${element} *`
    },
    "type-ref": (node) => node.args !== undefined && node.args.length > 0 ? unsupported("no generic types") : ident(node.name, "type-ref"),
    literal: () => unsupported("no literal types"),
    param: () => unsupported("no type parameters"),
    object: () => unsupported("declare a struct instead of an object type"),
    union: () => unsupported("no union types"),
    intersection: () => unsupported("no intersection types"),
    tuple: () => unsupported("no tuple types"),
    function: () => unsupported("no function types"),
    "indexed-access": () => unsupported("no indexed access types"),
    keyof: () => unsupported("no keyof"),
    conditional: () => unsupported("no conditional types"),
    mapped: () => unsupported("no mapped types"),
    "template-literal": () => unsupported("no template literal types"),
    "infer-var": () => unsupported("no infer"),
    "readonly-field": () => unsupported("no field modifiers"),
    "optional-field": () => unsupported("no field modifiers"),
    application: () => unsupported("no generic types"),
  },
})

const synthesizedReturn = (types: Synthesis, node: Fn.FunctionDeclaration<any, any, any>): Type.TypeExpr<any> | null => {
  const signature = types.typeOfFunction(node) as Type.Any | null
  return signature !== null && signature.tag === "function" ? signature.return : null
}

const bindingDeclaration = (node: BindingDeclaration, emit: CEmit, types: Synthesis): string => {
  const inferred = node.annotation ?? (node.expr === undefined ? null : types.tryTypeOf(node.expr))
  if (inferred === null) return unsupported(`cannot infer a C type for "${node.name}" — annotate it`)
  const type = emit.type(widen(inferred))
  const qualified = node.tag === "const-declaration" && !type.startsWith("const ") ? `const ${type}` : type
  const init = node.expr === undefined ? "" : ` = ${emit.expr(node.expr).text}`
  return `${declare(qualified, ident(node.name, node.tag))}${init};`
}

export const emitProgramC = (program: Program<unknown>, oracle?: TypeOracle): string => {
  const imports = collectImports(program.statements)
  if (imports.length > 0) {
    return unsupported(`no module imports (found "${imports[0]!.local}" from "${imports[0]!.source}")`)
  }
  const emit: CEmit = makeEmit(c(synthesize(program.statements, oracle)))
  return program.statements.map(emit.statement).join("\n")
}
