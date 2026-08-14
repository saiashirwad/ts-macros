// CUDA target: C-family policy plus what CUDA adds — kernel launches,
// __global__/__shared__ qualifiers, Ptr<T> out-params, per-target widths.
import {
  at,
  collectImports,
  frag,
  type Fragment,
  makeEmit,
  type Synthesis,
  synthesize,
  type Target,
  type TypeOracle,
  widen,
} from "../../src/emit/index.ts"
import type * as Expr from "../../src/expr.ts"
import type * as Fn from "../../src/function.ts"
import { makePipeable } from "../../src/pipeable.ts"
import type { Program } from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"
import {
  bindingDeclaration,
  blockText,
  type CEmit,
  cFamily,
  declare,
  ident,
  isOwnedType,
  param,
  POSTFIX,
  scalarOracle,
  synthesizedReturn,
} from "../c-family/index.ts"
import { insertFrees } from "../c/ownership.ts"

export { int, type Owned, owned } from "../c-family/index.ts"

const unsupported = (what: string): never => {
  throw new Error(`cuda target: ${what}`)
}

// --- CUDA-specific surface -------------------------------------------------

// a kernel is a __global__ function; CUDA requires kernels to return void,
// and the void phantom means an impl that falls off the end typechecks
// (In<void>). The emitter renders the signature as void by CUDA policy.
export const kernel = (): Type.TypeExpr<void> => Type.Ref<void>("Kernel")

// __shared__ storage on a binding's type
export const shared = <A>(inner: Type.TypeExpr<A>): Type.TypeExpr<A> => Type.Ref<A>("Shared", inner)

// per-target scalar widths: number stays double like the C target, but
// programs that want device floats name them
export const f32 = (): Type.TypeExpr<number> => Type.Ref<number>("F32")

declare const PtrId: unique symbol

interface PtrBrand {
  readonly [PtrId]?: true
}

// a callee param the function writes through (cudaMalloc's void **). cudaFn
// records such params on the var-ref; the call handler spells the matching
// argument as its address. The narrow address-of workaround: the core IR
// has no & node, and adding one would be a core change every target pays
// for — the marker lives on the FFI signature instead.
export type Ptr<A> = A & PtrBrand

export const ptr = <A>(inner: Type.TypeExpr<A>): Type.TypeExpr<Ptr<A>> => Type.Ref<Ptr<A>>("Ptr", inner)

// FFI whose signature the emitter can see: phantoms are erased at runtime,
// so a plain Value() cannot tell the call handler which params are Ptr<T>.
// cudaFn records the param types on the var-ref (same piggyback launch()
// uses); the phantom stays a plain function type.
export const cudaFn = <R = unknown, const P extends readonly Type.TypeExpr<any>[] = readonly Type.TypeExpr<any>[]>(
  name: string,
  params: P,
): Expr.VarRef<(...args: { [K in keyof P]: P[K] extends Type.TypeExpr<infer A> ? A : never }) => R> =>
  makePipeable({ tag: "var-ref", name, params }) as unknown as Expr.VarRef<
    (...args: { [K in keyof P]: P[K] extends Type.TypeExpr<infer A> ? A : never }) => R
  >

// a function-ref that also carries its launch configuration; the cuda
// emitter spells calls to it as name<<<grid, block>>>(args), every other
// emitter reads it as a plain call
export type Launched<K> = K & { readonly launch: { readonly grid: Expr.Expr<any>; readonly block: Expr.Expr<any> } }

export const launch = <
  K extends { readonly name: string },
  Grid extends Expr.Expr<any>,
  Block extends Expr.Expr<any>,
>(
  kernelRef: K,
  grid: Grid,
  block: Block,
): Launched<K> => makePipeable({ tag: "var-ref", name: kernelRef.name, launch: { grid, block } }) as unknown as Launched<K>

const isPtrType = (type: Type.TypeExpr<any>): boolean => {
  const node = type as Type.Any
  return node.tag === "type-ref" && node.name === "Ptr" && node.args !== undefined && node.args.length === 1
}

export const cuda = (types: Synthesis): Target<Fragment, string, string> => {
  const base = cFamily(unsupported)
  return {
    expr: {
      ...base.expr,
      "call-expr": (node, emit) => {
        const callee = node.callee as unknown as {
          readonly name?: string
          readonly launch?: { readonly grid: Expr.Expr<any>; readonly block: Expr.Expr<any> }
          readonly params?: readonly Type.TypeExpr<any>[]
        }
        if (callee.launch !== undefined) {
          return frag(
            POSTFIX,
            `${ident(callee.name!, "kernel launch")}<<<${emit.expr(callee.launch.grid).text}, ${emit.expr(callee.launch.block).text}>>>(${
              node.args.map((arg) => emit.expr(arg).text).join(", ")
            })`,
          )
        }
        // a Ptr<T> param is an out-param the callee writes through: pass the
        // argument's address instead of its value
        const args = node.args.map((arg, index) => {
          const param = callee.params?.[index]
          const text = emit.expr(arg).text
          return param !== undefined && isPtrType(param) ? `&${text}` : text
        })
        return frag(POSTFIX, `${at(emit.expr(node.callee), POSTFIX)}(${args.join(", ")})`)
      },
    },
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
        const qualifier = qualifierOf(returnType)
        const signatureType = qualifier === "__global__" ? "void" : emit.type(widen(returnType))
        const signature = declare(signatureType, ident(node.name, "function-declaration"))
        const params = node.params.map((p: Fn.AnyParam) => param(emit, p, unsupported)).join(", ")
        return `${qualifier === null ? "" : `${qualifier} `}${signature}(${params.length === 0 ? "void" : params}) ${blockText(emit, node.body)}`
      },
    },
    type: {
      ...base.type,
      "type-ref": (node, emit) => {
        if (isOwnedType(node)) {
          const inner = emit.type(node.args![0]!)
          return inner.startsWith("const ") ? inner.slice("const ".length) : inner
        }
        switch (node.name) {
          case "Int":
            return "int"
          case "F32":
            return "float"
          case "Shared":
            return `__shared__ ${emit.type(node.args![0]!)}`
          case "Ptr":
            return emit.type(node.args![0]!)
          default:
            break
        }
        return node.args !== undefined && node.args.length > 0 ? unsupported("no generic types") : ident(node.name, "type-ref")
      },
    },
  }
}

// the qualifier a function declaration carries, when its return type is
// wrapped in a Kernel refinement
const qualifierOf = (type: Type.TypeExpr<any> | undefined): "__global__" | null => {
  if (type === undefined) return null
  const node = type as Type.Any
  return node.tag === "type-ref" && node.name === "Kernel" ? "__global__" : null
}

// Int and F32 compute as numbers even though bindings keep them nominal
const cudaOracle = (user: TypeOracle | undefined): TypeOracle => scalarOracle(user, "Int", "F32")

export const emitProgramCuda = (program: Program<unknown>, oracle?: TypeOracle): string => {
  const imports = collectImports(program.statements)
  if (imports.length > 0) {
    return unsupported(`no module imports (found "${imports[0]!.local}" from "${imports[0]!.source}")`)
  }
  const resolved = cudaOracle(oracle)
  const lowered = insertFrees(program.statements, synthesize(program.statements, resolved))
  // lowering rebuilds statements, so the emitter synthesizes the tree it emits
  const emit: CEmit = makeEmit(cuda(synthesize(lowered, resolved)))
  return [
    "#include <cuda_runtime.h>",
    "#include <stdio.h>",
    "",
    ...lowered.map(emit.statement),
  ].join("\n")
}
