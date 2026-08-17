import {
  collectBindingNames,
  collectImports,
  type Fragment,
  makeEmit,
  type Synthesis,
  synthesize,
  type Target,
  type TypeOracle,
} from "../../src/emit/index.ts"
import type * as Fn from "../../src/function.ts"
import type { Program } from "../../src/program.ts"
import {
  bindingDeclaration,
  blockText,
  C_NOMINALS,
  calledBeforeDeclaration,
  type CEmit,
  cFamily,
  ident,
  isOwnedType,
  scalarOracle,
  signatureOf,
} from "../c-family/index.ts"
import { insertFrees } from "./ownership.ts"

export { f32, int } from "../c-family/index.ts"
export { insertFrees, isOwnedType, type Owned, owned } from "./ownership.ts"

const unsupported = (what: string): never => {
  throw new Error(`c target: ${what}`)
}

export const c = (types: Synthesis): Target<Fragment, string, string> => {
  const base = cFamily(unsupported, types)
  const signature = (node: Fn.FunctionDeclaration<any, any, any>, emit: CEmit): string => signatureOf(node, emit, types, unsupported)
  return {
    expr: base.expr,
    statement: {
      ...base.statement,
      "let-declaration": (node, emit) => bindingDeclaration(node, emit, types, unsupported),
      "const-declaration": (node, emit) => bindingDeclaration(node, emit, types, unsupported),
      "function-declaration": (node, emit) => `${signature(node, emit)} ${blockText(emit, node.body!)}`,
    },
    type: {
      ...base.type,
      "type-ref": (node, emit) => {
        if (isOwnedType(node)) {
          const inner = emit.type(node.args![0]!)
          return inner.startsWith("const ") ? inner.slice("const ".length) : inner
        }
        if (node.args !== undefined && node.args.length > 0) {
          return unsupported("no generic types")
        }
        if (node.name in C_NOMINALS) {
          return C_NOMINALS[node.name as keyof typeof C_NOMINALS]!
        }
        return node.erasesTo !== undefined ? emit.type(node.erasesTo) : ident(node.name, "type-ref")
      },
    },
    program: (program, emit) => {
      const hoisted = calledBeforeDeclaration(program.statements)
      const prototypes = program.statements
        .filter((statement): statement is Fn.FunctionDeclaration<any, any, any> =>
          statement.tag === "function-declaration" && hoisted.has(statement.id)
        )
        .map((statement) => `${signature(statement, emit)};`)
      return { c: [...prototypes, ...program.statements.map(emit.statement)] }
    },
  }
}

const cOracle = (user: TypeOracle | undefined): TypeOracle => scalarOracle(user)

export const emitProgramC = (program: Program<unknown>, oracle?: TypeOracle): string => {
  const imports = collectImports(program.statements)
  if (imports.length > 0) {
    return unsupported(`no module imports (found "${imports[0]!.local}" from "${imports[0]!.source}")`)
  }
  const resolved = cOracle(oracle)
  const lowered = insertFrees(program.statements, synthesize(program.statements, resolved))
  const target = c(synthesize(lowered, resolved))
  const emit: CEmit = makeEmit(target, collectBindingNames(lowered))
  return Object.values(target.program!({ statements: lowered, result: program.result }, emit)).flat().join("\n")
}
