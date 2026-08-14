import { collectImports, type Fragment, makeEmit, type Synthesis, synthesize, type Target, type TypeOracle, widen } from "../../src/emit/index.ts"
import type * as Fn from "../../src/function.ts"
import type { Program } from "../../src/program.ts"
import {
  bindingDeclaration,
  blockText,
  type CEmit,
  cFamily,
  declare,
  ident,
  isOwnedType,
  param,
  scalarOracle,
  synthesizedReturn,
} from "../c-family/index.ts"
import { insertFrees } from "./ownership.ts"

export { int } from "../c-family/index.ts"
export { insertFrees, isOwnedType, type Owned, owned } from "./ownership.ts"

const unsupported = (what: string): never => {
  throw new Error(`c target: ${what}`)
}

export const c = (types: Synthesis): Target<Fragment, string, string> => {
  const base = cFamily(unsupported)
  return {
    expr: base.expr,
    statement: {
      ...base.statement,
      binding: (node, emit) => bindingDeclaration(node, emit, types, unsupported),
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
        const params = node.params.map((p: Fn.AnyParam) => param(emit, p, unsupported)).join(", ")
        return `${signature}(${params.length === 0 ? "void" : params}) ${blockText(emit, node.body)}`
      },
    },
    type: {
      ...base.type,
      "type-ref": (node, emit) => {
        // an owned value is a pointer the program frees; const would forbid that
        if (isOwnedType(node)) {
          const inner = emit.type(node.args![0]!)
          return inner.startsWith("const ") ? inner.slice("const ".length) : inner
        }
        if (node.name === "Int" && (node.args === undefined || node.args.length === 0)) return "int"
        return node.args !== undefined && node.args.length > 0 ? unsupported("no generic types") : ident(node.name, "type-ref")
      },
    },
  }
}

// Int computes as a number even though bindings keep it nominal
const cOracle = (user: TypeOracle | undefined): TypeOracle => scalarOracle(user, "Int")

export const emitProgramC = (program: Program<unknown>, oracle?: TypeOracle): string => {
  const imports = collectImports(program.statements)
  if (imports.length > 0) {
    return unsupported(`no module imports (found "${imports[0]!.local}" from "${imports[0]!.source}")`)
  }
  const resolved = cOracle(oracle)
  const lowered = insertFrees(program.statements, synthesize(program.statements, resolved))
  // lowering rebuilds statements, so the emitter synthesizes the tree it emits
  const emit: CEmit = makeEmit(c(synthesize(lowered, resolved)))
  return lowered.map(emit.statement).join("\n")
}
