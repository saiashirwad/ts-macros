import type * as Binding from "../binding.ts"
import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { BindingId } from "../identity.ts"
import type { ForOfStatement, Statement } from "../statement.ts"
import * as Type from "../types/index.ts"
import { walk } from "../walk.ts"
import { widen } from "./type-ir.ts"

type TypeNode = Type.TypeExpr<any>

export interface TypeOracle {
  externalRef?(node: Expr.ExternalRef<any>): TypeNode | null
  typeRef?(node: Type.TypeRef<any>): TypeNode | null
}

export interface Synthesis {
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

export const synthesize = (statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Synthesis => {
  const bindings = new Map<BindingId, TypeNode>()
  const fns = new Map<BindingId, Fn.FunctionDeclaration<any, any, any>>()

  walk(statements, (node) => {
    switch (node.tag) {
      case "let-declaration":
      case "const-declaration": {
        const decl = node as unknown as Binding.BindingDeclaration
        const type = decl.annotation ?? decl.type
        if (type !== undefined) bindings.set(decl.id, type)
        break
      }
      case "param": {
        const param = node as unknown as Fn.AnyParam
        bindings.set(param.id, param.type)
        break
      }
      case "for-of": {
        const forOf = node as unknown as ForOfStatement
        const iterType = forOf.iterable.type as Type.Any | undefined
        if (iterType?.tag === "array") bindings.set(forOf.id, iterType.element)
        else if (
          (iterType?.tag === "primitive" && iterType.name === "string") || (iterType?.tag === "literal" && typeof iterType.value === "string")
        ) {
          bindings.set(forOf.id, Type.String())
        }
        break
      }
      case "function-declaration": {
        const fn = node as unknown as Fn.FunctionDeclaration<any, any, any>
        fns.set(fn.id, fn)
        if (fn.returnType !== undefined) {
          bindings.set(fn.id, Type.Function(fn.params.map((p: Fn.AnyParam) => p.type), fn.returnType))
        }
        break
      }
    }
  })

  const resolve = (type: TypeNode | null): TypeNode | null => {
    if (type === null) return null
    const node = type as Type.Any
    return node.tag === "type-ref" ? oracle?.typeRef?.(node) ?? type : type
  }

  const tryTypeOf = (expr: Expr.Expr<any>): TypeNode | null => {
    const node = expr as Expr.Any | Fn.Any
    switch (node.tag) {
      case "external-ref":
        return oracle?.externalRef?.(node) ?? null
      case "var-ref":
        return node.type ?? bindings.get(node.target) ?? null
      case "function-ref":
      case "generic-function-ref": {
        const fnDecl = fns.get(node.target)
        if (fnDecl?.returnType !== undefined) {
          return Type.Function(fnDecl.params.map((p: Fn.AnyParam) => p.type), fnDecl.returnType)
        }
        return node.type ?? bindings.get(node.target) ?? null
      }

      case "call-expr": {
        if (node.type !== undefined) return node.type
        const calleeType = tryTypeOf(node.callee) as Type.Any | null
        if (calleeType?.tag === "function") return calleeType.return
        const calleeNode = node.callee as { readonly target?: BindingId }
        if (calleeNode.target !== undefined) {
          const fn = fns.get(calleeNode.target)
          if (fn?.returnType !== undefined) return fn.returnType
        }
        return null
      }
      case "prop": {
        if (node.type !== undefined) return node.type
        const objType = tryTypeOf(node.object) as Type.Object | null
        return objType?.tag === "object" ? objType.fields[node.key] ?? null : null
      }
      case "index": {
        if (node.type !== undefined) return node.type
        const objType = tryTypeOf(node.object) as Type.ArrayType<any> | null
        return objType?.tag === "array" ? objType.element : null
      }
      case "binary": {
        if (node.type !== undefined) return node.type
        const left = tryTypeOf(node.left)
        const right = tryTypeOf(node.right)
        if (left === null || right === null) return null
        switch (node.op) {
          case "===":
          case "!==":
          case "<":
          case "<=":
          case ">":
          case ">=":
            return Type.Boolean()
          case "&&":
          case "||":
            return left ?? right
          case "+": {
            const lw = resolve(widen(left)) as Type.Any
            const rw = resolve(widen(right)) as Type.Any
            if ((lw.tag === "primitive" && lw.name === "string") || (rw.tag === "primitive" && rw.name === "string")) return Type.String()
            if (lw.tag === "primitive" && lw.name === "number" && rw.tag === "primitive" && rw.name === "number") {
              return (left as Type.Any).tag === "type-ref" && (right as Type.Any).tag === "type-ref" && (left as any).name === (right as any).name
                ? left
                : Type.Number()
            }
            return null
          }
          default: {
            const lw = resolve(widen(left)) as Type.Any
            const rw = resolve(widen(right)) as Type.Any
            if (lw.tag === "primitive" && lw.name === "number" && rw.tag === "primitive" && rw.name === "number") {
              return (left as Type.Any).tag === "type-ref" && (right as Type.Any).tag === "type-ref" && (left as any).name === (right as any).name
                ? left
                : Type.Number()
            }
            return null
          }
        }
      }
      case "cond": {
        if (node.type !== undefined) return node.type
        const then = tryTypeOf(node.then)
        const else_ = tryTypeOf(node.else)
        return then ?? else_
      }
      case "assign":
        return tryTypeOf(node.target) ?? tryTypeOf(node.value)
      case "unary":
        return node.op === "!" ? Type.Boolean() : Type.String()
      case "template":
        return Type.String()
      case "array": {
        if (node.type !== undefined) return node.type
        if (node.elements.length === 0) return null
        const el = tryTypeOf(node.elements[0])
        return el === null ? null : Type.Array(widen(el))
      }
      case "object": {
        if (node.type !== undefined) return node.type
        const fields: Record<string, TypeNode> = {}
        for (const [k, v] of Object.entries(node.fields)) {
          const t = tryTypeOf(v)
          if (t === null) return null
          fields[k] = widen(t)
        }
        return Type.Object(fields)
      }
      case "instantiation":
        return null
      case "arrow":
        return node.type ?? null
      default:
        return node.type ?? null
    }
  }

  const typeOfFunction = (node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null => {
    if (node.returnType !== undefined) {
      return Type.Function(node.params.map((p: Fn.AnyParam) => p.type), node.returnType)
    }
    const found = fns.get(node.id)
    if (found?.returnType !== undefined) {
      return Type.Function(found.params.map((p: Fn.AnyParam) => p.type), found.returnType)
    }
    return null
  }

  return {
    tryTypeOf,
    typeOfFunction,
  }
}
