import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import type { Block, Statement } from "../statement.ts"
import * as Type from "../types/index.ts"
import { typeExprToText } from "./text.ts"

type TypeNode = Type.TypeExpr<any>

// resolves what the tree cannot see: varRef types erased leaves (FFI refs) —
// the path2 driver can back it with the real TypeScript checker — and
// typeRef gives nominal refs an underlying type for computation while they
// stay nominal in bindings
export interface TypeOracle {
  varRef?(node: Expr.VarRef<any, any>): TypeNode | null
  typeRef?(node: Type.TypeRef<any>): TypeNode | null
}

export interface Synthesis {
  typeOf(expr: Expr.Expr<any>): TypeNode
  tryTypeOf(expr: Expr.Expr<any>): TypeNode | null
  typeOfFunction(node: Fn.FunctionDeclaration<any, any, any>): TypeNode | null
}

const primitiveOf = (value: string | number | boolean): TypeNode =>
  typeof value === "string" ? Type.String() : typeof value === "number" ? Type.Number() : Type.Boolean()

export const widen = (type: TypeNode): TypeNode => {
  const node = type as Type.Any
  switch (node.tag) {
    case "literal":
      return node.value === null ? type : primitiveOf(node.value)
    case "object":
      return Type.Object(
        Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, widen(value)])),
      )
    case "array":
      return Type.Array(widen(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(widen))
    default:
      return type
  }
}

// the runtime counterpart of the type-level Substitute: replace named type
// params, rebuild everything else
export const substituteType = (type: TypeNode, bindings: ReadonlyMap<string, TypeNode>): TypeNode => {
  const node = type as Type.Any
  const sub = (t: TypeNode): TypeNode => substituteType(t, bindings)
  switch (node.tag) {
    case "param":
      return bindings.get(node.name) ?? type
    case "object":
      return Type.Object(Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, sub(value)])))
    case "union":
      return Type.Union(...node.members.map(sub) as [TypeNode, TypeNode, ...TypeNode[]])
    case "intersection":
      return Type.Intersection(...node.members.map(sub) as [TypeNode, TypeNode, ...TypeNode[]])
    case "array":
      return Type.Array(sub(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(sub))
    case "function":
      return Type.Function(node.params.map(sub), sub(node.return), node.rest === undefined ? undefined : sub(node.rest))
    case "indexed-access":
      return Type.Index(sub(node.object), sub(node.key))
    case "keyof":
      return Type.KeyOf(sub(node.operand))
    case "conditional":
      return Type.Conditional(sub(node.check), sub(node.extends), sub(node.then), sub(node.else))
    case "mapped":
      return Type.Mapped(node.key, sub(node.source), sub(node.body))
    case "template-literal":
      return Type.TemplateLiteral(node.parts, ...node.exprs.map(sub))
    case "readonly-field":
      return Type.Readonly(sub(node.field))
    case "optional-field":
      return Type.Optional(sub(node.field))
    case "type-ref":
      return node.args === undefined || node.args.length === 0 ? type : Type.Ref(node.name, ...node.args.map(sub))
    case "application":
      return Type.Apply(sub(node.callee), node.args.map(sub))
    default:
      return type
  }
}

const sameType = (a: TypeNode, b: TypeNode): boolean => typeExprToText(a) === typeExprToText(b)

const lub = (types: readonly TypeNode[]): TypeNode => {
  const distinct: TypeNode[] = []
  for (const type of types) {
    if (!distinct.some((seen) => sameType(seen, type))) distinct.push(type)
  }
  return distinct.length === 1 ? distinct[0]! : Type.Union(...distinct as [TypeNode, TypeNode, ...TypeNode[]])
}

const isPrimitive = (type: TypeNode | null, name: Type.PrimitiveName): boolean =>
  type !== null && (type as Type.Any).tag === "primitive" && (type as Type.Primitive).name === name

const fieldType = (object: TypeNode, key: string): TypeNode | null => {
  const node = object as Type.Any
  if (node.tag !== "object") return null
  let current = node.fields[key] as Type.Any | undefined
  while (current !== undefined && (current.tag === "readonly-field" || current.tag === "optional-field")) {
    current = current.field as Type.Any
  }
  return current ?? null
}

const collectReturns = (block: Block): Expr.Expr<any>[] => {
  const values: Expr.Expr<any>[] = []
  const visit = (statements: ReadonlyArray<Statement>): void => {
    for (const statement of statements) {
      switch (statement.tag) {
        case "return":
          values.push(statement.value)
          break
        case "if":
          statement.clauses.forEach((clause) => visit(clause.body.statements))
          if (statement.else !== null) visit(statement.else.statements)
          break
        case "while":
        case "for-of":
          visit(statement.body.statements)
          break
        default:
          break
      }
    }
  }
  visit(block.statements)
  return values
}

interface GenericEntry {
  readonly typeParams: readonly string[]
  readonly params: readonly TypeNode[]
  readonly result: TypeNode | null
}

export const synthesize = (statements: ReadonlyArray<Statement>, oracle?: TypeOracle): Synthesis => {
  const memo = new Map<Expr.Expr<any>, TypeNode | null>()
  const fns = new Map<Fn.FunctionDeclaration<any, any, any>, TypeNode | null>()
  const generics = new Map<string, GenericEntry>()
  const scopes: Array<Map<string, TypeNode | null>> = [new Map()]

  const lookup = (name: string): TypeNode | null => {
    for (let index = scopes.length - 1; index >= 0; index--) {
      const found = scopes[index]!.get(name)
      if (found !== undefined) return found
    }
    return null
  }

  const define = (name: string, type: TypeNode | null): void => {
    scopes[scopes.length - 1]!.set(name, type)
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
      case "var-ref":
        return lookup(node.name) ?? oracle?.varRef?.(node) ?? null
      case "function-ref":
        return lookup(node.name)
      case "generic-function-ref":
        return null
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
          fields[key] = type
        }
        return Type.Object(fields)
      }
      case "call-expr": {
        node.args.forEach(exprType)
        const callee = exprType(node.callee) as Type.Any | null
        return callee?.tag === "function" ? callee.return : null
      }
      case "instantiation": {
        const callee = node.callee as Expr.Any | Fn.Any
        if (callee.tag !== "generic-function-ref") return null
        const entry = generics.get(callee.name)
        if (entry === undefined || entry.result === null) return null
        const bindings = new Map(entry.typeParams.map((name, index) => [name, node.typeArgs[index]!]))
        return Type.Function(
          entry.params.map((param) => substituteType(param, bindings)),
          substituteType(entry.result, bindings),
        )
      }
      case "arrow":
        return scoped(() => {
          for (const param of node.params) define(param.name, param.type)
          walkStatements(node.body.statements)
          const returns = returnTypesOf(node.body)
          return returns === null ? null : Type.Function(node.params.map((param) => param.type), returns)
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
        return isPrimitive(lw, "number") && isPrimitive(rw, "number") ? Type.Number() : null
      }
      default:
        return isPrimitive(resolve(left === null ? null : widen(left)), "number")
            && isPrimitive(resolve(right === null ? null : widen(right)), "number")
          ? Type.Number()
          : null
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
    const typeParams: Type.AnyParams = node.typeParams
    const declared = node.returnType
    if (typeParams.length === 0 && declared !== undefined) {
      define(node.name, Type.Function(params.map((param) => param.type), declared))
    }
    const inferred = node.body === undefined ? null : scoped(() => {
      for (const param of params) define(param.name, param.type)
      walkStatements(node.body!.statements)
      return returnTypesOf(node.body!)
    })
    const result = declared ?? inferred
    if (typeParams.length > 0) {
      generics.set(node.name, {
        typeParams: typeParams.map((param) => param.name),
        params: params.map((param) => param.type),
        result,
      })
      fns.set(node, null)
      return
    }
    const signature = result === null ? null : Type.Function(params.map((param) => param.type), result)
    define(node.name, signature)
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
          define(statement.name, type)
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
            define(statement.name, element)
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
    typeOf: (expr) => {
      const type = tryTypeOf(expr)
      if (type === null) {
        throw new Error(`cannot synthesize a type for "${(expr as unknown as { readonly tag: string }).tag}" — annotate it`)
      }
      return type
    },
    typeOfFunction: (node) => fns.get(node) ?? null,
  }
}
