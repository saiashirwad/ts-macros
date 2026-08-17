import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { BindingId } from "../identity.ts"
import type { Block, Statement } from "../statement.ts"
import * as Type from "../types/index.ts"
import { lub, sameType, widen } from "./type-ir.ts"

type TypeNode = Type.TypeExpr<any>

export interface TypeOracle {
  externalRef?(node: Expr.ExternalRef<any>): TypeNode | null
  typeRef?(node: Type.TypeRef<any>): TypeNode | null
}

export interface Synthesis {
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

const keepNominalNumber = (left: TypeNode, right: TypeNode): TypeNode =>
  sameType(left, right) && (left as Type.Any).tag === "type-ref" ? left : Type.Number()

const isPrimitive = (type: TypeNode | null, name: Type.PrimitiveName): boolean =>
  (type as Type.Any)?.tag === "primitive" && (type as Type.Primitive).name === name

const fieldType = (object: TypeNode, key: string): TypeNode | null =>
  (object as Type.Object)?.tag === "object" ? ((object as Type.Object).fields[key] ?? null) : null

const collectReturns = (block: Block): Expr.Expr<any>[] => {
  const values: Expr.Expr<any>[] = []
  const visit = (statements: ReadonlyArray<Statement>): void => {
    for (const statement of statements) {
      if (statement.tag === "return") {
        values.push(statement.value)
      } else if (statement.tag === "if") {
        statement.clauses.forEach((clause) => visit(clause.body.statements))
        if (statement.else !== null) visit(statement.else.statements)
      } else if (statement.tag === "while" || statement.tag === "for-of") {
        visit(statement.body.statements)
      }
    }
  }
  visit(block.statements)
  return values
}

export const synthesize = (statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Synthesis => {
  const memo = new Map<Expr.Expr<any>, TypeNode | null>()
  const fns = new Map<Fn.FunctionDeclaration<any, any, any>, TypeNode | null>()
  const scopes: Array<Map<BindingId, TypeNode | null>> = [new Map()]

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

  const exprType = (expr: Expr.Expr<any>): TypeNode | null => {
    const cached = memo.get(expr)
    if (cached !== undefined) return cached
    const type = compute(expr)
    memo.set(expr, type)
    return type
  }

  const compute = (expr: Expr.Expr<any>): TypeNode | null => {
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
        return object === null ? null : fieldType(object, node.key)
      }
      case "index": {
        exprType(node.index)
        const object = exprType(node.object) as Type.Any | null
        return object?.tag === "array" ? object.element : null
      }
      case "array": {
        const elements: Array<TypeNode | null> = node.elements.map((element: Expr.Expr<any>) => exprType(element))
        if (elements.length === 0 || elements.some((element) => element === null)) return null
        return Type.Array(lub(elements.map((element) => widen(element!))))
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
        return binaryType(node)
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
      case "assign": {
        exprType(node.value)
        return exprType(node.target)
      }
    }
  }

  const resolve = (type: TypeNode | null): TypeNode | null => {
    if (type === null) return null
    const node = type as Type.Any
    return node.tag === "type-ref" ? oracle?.typeRef?.(node) ?? type : type
  }

  const binaryType = (node: Expr.Binary<Expr.BinaryOperator, Expr.Expr<any>, Expr.Expr<any>>): TypeNode | null => {
    const left = exprType(node.left)
    const right = exprType(node.right)
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
        return left !== null && right !== null ? lub([left, right]) : null
      case "+": {
        if (left === null || right === null) return null
        const lw = resolve(widen(left))
        const rw = resolve(widen(right))
        if (isPrimitive(lw, "string") || isPrimitive(rw, "string")) return Type.String()
        if (isPrimitive(lw, "number") && isPrimitive(rw, "number")) return keepNominalNumber(left, right)
        return null
      }
      default: {
        if (left === null || right === null) return null
        const lw = resolve(widen(left))
        const rw = resolve(widen(right))
        if (isPrimitive(lw, "number") && isPrimitive(rw, "number")) return keepNominalNumber(left, right)
        return null
      }
    }
  }

  const returnTypesOf = (block: Block): TypeNode | null => {
    const values = collectReturns(block)
    if (values.length === 0) return Type.Void()
    const types = values.map(exprType)
    if (types.some((type) => type === null)) return null
    return lub(types.map((type) => widen(type!)))
  }

  const walkFunction = (node: Fn.FunctionDeclaration<any, any, any>): void => {
    const params: readonly Fn.AnyParam[] = node.params
    const declared = node.returnType
    if (node.typeParams.length > 0) {
      fns.set(node, null)
      return
    }
    if (declared !== undefined) {
      define(node.id, Type.Function(params.map((param) => param.type), declared))
    }
    const inferred = node.body === undefined ? null : scoped(() => {
      for (const param of params) define(param.id, param.type)
      walkStatements(node.body!.statements)
      return returnTypesOf(node.body!)
    })
    const result = declared ?? inferred
    const signature = result === null ? null : Type.Function(params.map((param) => param.type), result)
    define(node.id, signature)
    fns.set(node, signature)
  }

  const walkStatements = (list: ReadonlyArray<Statement>): void => {
    for (const statement of list) {
      switch (statement.tag) {
        case "let-declaration":
        case "const-declaration": {
          const init = statement.expr === undefined ? null : exprType(statement.expr)
          const type = statement.annotation
            ?? (init === null ? null : statement.tag === "let-declaration" ? widen(init) : init)
          define(statement.id, type)
          break
        }
        case "function-declaration":
          walkFunction(statement)
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
          if (statement.else !== null) scoped(() => walkStatements(statement.else!.statements))
          break
        case "while":
          exprType(statement.condition)
          scoped(() => walkStatements(statement.body.statements))
          break
        case "for-of": {
          const iterable = exprType(statement.iterable) as Type.Any | null
          const element = iterable?.tag === "array" ? iterable.element : isPrimitive(iterable, "string") ? Type.String() : null
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

  const tryTypeOf = (expr: Expr.Expr<any>): TypeNode | null => exprType(expr)

  return {
    tryTypeOf,
    typeOfFunction: (node) => fns.get(node) ?? null,
  }
}
