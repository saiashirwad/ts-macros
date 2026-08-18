import * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { BindingId } from "../identity.ts"
import { type Block, collectReturns, type Statement } from "../statement.ts"
import * as Type from "../types/index.ts"
import { binaryType, lub, widen } from "../types/lattice.ts"

export type TypeNode = Type.TypeExpr<any>

export interface TypeOracle {
  externalRef?(node: Expr.ExternalRef<any>): TypeNode | null
  typeRef?(node: Type.TypeRef<any>): TypeNode | null
}

export interface Inferencer {
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

export const inferProgram = (statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Inferencer => {
  const memo = new Map<Expr.Expr<any>, TypeNode | null>()
  const functions = new Map<Fn.FunctionDeclaration<any, any, any>, TypeNode | null>()
  const scopes: Array<Map<BindingId, TypeNode | null>> = [new Map()]
  const visiting = new Set<Fn.FunctionDeclaration<any, any, any>>()

  const lookup = (id: BindingId): TypeNode | null => {
    for (let index = scopes.length - 1; index >= 0; index--) {
      const found = scopes[index]!.get(id)
      if (found !== undefined) return found
    }
    return null
  }

  const define = (id: BindingId, type: TypeNode | null): void => {
    scopes[scopes.length - 1]!.set(id, type)
  }

  const scoped = <A>(body: () => A): A => {
    scopes.push(new Map())
    try {
      return body()
    } finally {
      scopes.pop()
    }
  }

  const resolve = (type: TypeNode): TypeNode => {
    const node = type as Type.Any
    return node.tag === "type-ref" ? oracle?.typeRef?.(node) ?? type : type
  }

  const exprType = (expr: Expr.Expr<any>): TypeNode | null => {
    const cached = memo.get(expr)
    if (cached !== undefined) return cached
    const type = inferExpr(expr)
    memo.set(expr, type)
    return type
  }

  const returnTypesOf = (block: Block): TypeNode | null => {
    const values = collectReturns(block)
    if (values.length === 0) return Type.Void()
    const types = values.map(exprType)
    if (types.some((type) => type === null)) return null
    return lub(types.map((type) => widen(type!)))
  }

  const inferFunction = (node: Fn.FunctionDeclaration<any, any, any>): void => {
    if (functions.has(node) || visiting.has(node)) return
    visiting.add(node)

    const params: readonly Fn.AnyParam[] = node.params
    const declared = node.returnType
    const known = node.type
    const declaredSignature = known
      ?? (declared === undefined ? null : Type.Function(params.map((param) => param.type), declared))

    if (declaredSignature !== null) define(node.id, declaredSignature)

    const inferred = node.body === undefined
      ? null
      : scoped(() => {
        for (const param of params) define(param.id, param.type)
        walkStatements(node.body!.statements)
        return returnTypesOf(node.body!)
      })

    const result = known?.tag === "function" ? known.return : (declared ?? inferred)
    const signature = result === null
      ? null
      : known ?? Type.Function(params.map((param) => param.type), result)

    define(node.id, signature)
    functions.set(node, signature)
    visiting.delete(node)
  }

  const inferExpr = (expr: Expr.Expr<any>): TypeNode | null => {
    if (expr.type !== undefined) return expr.type

    const node = expr as Expr.Any | Fn.Any
    switch (node.tag) {
      case "literal":
        return Type.Literal(node.value)
      case "external-ref":
        return oracle?.externalRef?.(node) ?? null
      case "var-ref":
      case "function-ref":
      case "generic-function-ref":
        return lookup(node.target)
      case "prop": {
        const object = exprType(node.object)
        const objectNode = object as Type.Any | null
        return objectNode?.tag === "object" ? objectNode.fields[node.key] ?? null : null
      }
      case "index": {
        exprType(node.index)
        const object = exprType(node.object) as Type.Any | null
        return object?.tag === "array" ? object.element : null
      }
      case "array": {
        if (node.elements.length === 0) return null
        const elements = node.elements.map((element: Expr.Expr<any>) => exprType(element))
        if (elements.some((element: TypeNode | null) => element === null)) return null
        return Type.Array(lub(elements.map((element: TypeNode | null) => widen(element!))))
      }
      case "object": {
        const fields: Record<string, TypeNode> = {}
        for (const [key, value] of Object.entries(node.fields)) {
          const type = exprType(value)
          if (type === null) return null
          fields[key] = widen(type)
        }
        return Type.Object(fields)
      }
      case "call-expr": {
        node.args.forEach(exprType)
        const callee = exprType(node.callee) as Type.Any | null
        return callee?.tag === "function" ? callee.return : null
      }
      case "instantiation":
        return null
      case "arrow":
        return scoped(() => {
          for (const param of node.params) define(param.id, param.type)
          walkStatements(node.body.statements)
          const returns = returnTypesOf(node.body)
          return returns === null ? null : Type.Function(node.params.map((param: Fn.AnyParam) => param.type), returns)
        })
      case "binary":
        return binaryType(node.op, exprType(node.left) ?? undefined, exprType(node.right) ?? undefined, resolve) ?? null
      case "unary":
        return node.op === "!" ? Type.Boolean() : Type.String()
      case "template":
        node.exprs.forEach(exprType)
        return Type.String()
      case "cond": {
        exprType(node.condition)
        const then = exprType(node.then)
        const else_ = exprType(node.else)
        return then !== null && else_ !== null ? lub([then, else_]) : null
      }
      case "assign":
        exprType(node.value)
        return exprType(node.target)
    }
  }

  const walkStatements = (list: ReadonlyArray<Statement>): void => {
    for (const statement of list) {
      switch (statement.tag) {
        case "let-declaration":
        case "const-declaration": {
          const init = statement.expr === undefined ? null : exprType(statement.expr)
          const type = statement.annotation
            ?? statement.type
            ?? (init === null ? null : statement.tag === "let-declaration" ? widen(init) : init)
          define(statement.id, type)
          break
        }
        case "function-declaration":
          inferFunction(statement)
          break
        case "type-declaration":
          break
        case "return":
        case "throw":
          exprType(statement.value)
          break
        case "expr-statement":
          exprType(statement.expr)
          break
        case "assign":
          exprType(statement)
          break
        case "break":
        case "continue":
          break
        case "if":
          for (const clause of statement.clauses) {
            exprType(clause.condition)
            scoped(() => walkStatements(clause.body.statements))
          }
          const elseBlock = statement.else
          if (elseBlock !== null) scoped(() => walkStatements(elseBlock.statements))
          break
        case "while":
          exprType(statement.condition)
          scoped(() => walkStatements(statement.body.statements))
          break
        case "for-of": {
          const iterable = exprType(statement.iterable) as Type.Any | null
          const element = iterable?.tag === "array"
            ? iterable.element
            : iterable?.tag === "primitive" && iterable.name === "string"
            ? Type.String()
            : iterable?.tag === "literal" && typeof iterable.value === "string"
            ? Type.String()
            : null
          scoped(() => {
            define(statement.id, element)
            walkStatements(statement.body.statements)
          })
          break
        }
      }
    }
  }

  walkStatements(statements)

  return {
    tryTypeOf: exprType,
    typeOfFunction: (node) => {
      inferFunction(node)
      return functions.get(node) ?? null
    },
  }
}
