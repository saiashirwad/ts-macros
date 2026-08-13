import type * as Fn from "../function.ts"
import type * as Type from "../types/index.ts"
import type { Target } from "./target.ts"

const nothing = (): void => {}

// visits every child and produces nothing; analyses spread it and
// override only the node kinds they care about
export const traversal: Target<void, void, void> = {
  expr: {
    literal: nothing,
    "var-ref": nothing,
    "function-ref": nothing,
    "generic-function-ref": nothing,
    prop: (node, emit) => emit.expr(node.object),
    index: (node, emit) => {
      emit.expr(node.object)
      emit.expr(node.index)
    },
    array: (node, emit) => node.elements.forEach(emit.expr),
    object: (node, emit) => Object.values(node.fields).forEach(emit.expr),
    "call-expr": (node, emit) => {
      emit.expr(node.callee)
      node.args.forEach(emit.expr)
    },
    instantiation: (node, emit) => {
      emit.expr(node.callee)
      node.typeArgs.forEach(emit.type)
    },
    arrow: (node, emit) => {
      node.params.forEach((param) => emit.type(param.type))
      emit.block(node.body)
    },
    binary: (node, emit) => {
      emit.expr(node.left)
      emit.expr(node.right)
    },
    unary: (node, emit) => emit.expr(node.operand),
    template: (node, emit) => node.exprs.forEach(emit.expr),
    cond: (node, emit) => {
      emit.expr(node.condition)
      emit.expr(node.then)
      emit.expr(node.else)
    },
    assign: (node, emit) => {
      emit.expr(node.target)
      emit.expr(node.value)
    },
  },
  statement: {
    "let-declaration": (node, emit) => {
      if (node.annotation !== undefined) emit.type(node.annotation)
      if (node.expr !== undefined) emit.expr(node.expr)
    },
    "const-declaration": (node, emit) => {
      if (node.annotation !== undefined) emit.type(node.annotation)
      if (node.expr !== undefined) emit.expr(node.expr)
    },
    "function-declaration": (node, emit) => {
      node.typeParams.forEach((param: Type.AnyParam) => {
        if (param.extends !== undefined) emit.type(param.extends)
      })
      node.params.forEach((param: Fn.AnyParam) => emit.type(param.type))
      if (node.returnType !== undefined) emit.type(node.returnType)
      if (node.body !== undefined) emit.block(node.body)
    },
    "type-declaration": (node, emit) => {
      node.params.forEach(emit.type)
      if (node.body !== undefined) emit.type(node.body)
    },
    return: (node, emit) => emit.expr(node.value),
    throw: (node, emit) => emit.expr(node.value),
    "expr-statement": (node, emit) => emit.expr(node.expr),
    assign: (node, emit) => emit.expr(node),
    break: nothing,
    continue: nothing,
    if: (node, emit) => {
      node.clauses.forEach((clause) => {
        emit.expr(clause.condition)
        emit.block(clause.body)
      })
      if (node.else !== null) emit.block(node.else)
    },
    while: (node, emit) => {
      emit.expr(node.condition)
      emit.block(node.body)
    },
    "for-of": (node, emit) => {
      emit.expr(node.iterable)
      emit.block(node.body)
    },
  },
  type: {
    primitive: nothing,
    literal: nothing,
    "infer-var": nothing,
    param: (node, emit) => {
      if (node.extends !== undefined) emit.type(node.extends)
    },
    object: (node, emit) => Object.values(node.fields).forEach(emit.type),
    union: (node, emit) => node.members.forEach(emit.type),
    intersection: (node, emit) => node.members.forEach(emit.type),
    array: (node, emit) => emit.type(node.element),
    tuple: (node, emit) => node.items.forEach(emit.type),
    function: (node, emit) => {
      node.params.forEach(emit.type)
      emit.type(node.return)
      if (node.rest !== undefined) emit.type(node.rest)
    },
    "indexed-access": (node, emit) => {
      emit.type(node.object)
      emit.type(node.key)
    },
    keyof: (node, emit) => emit.type(node.operand),
    conditional: (node, emit) => {
      emit.type(node.check)
      emit.type(node.extends)
      emit.type(node.then)
      emit.type(node.else)
    },
    mapped: (node, emit) => {
      emit.type(node.source)
      emit.type(node.body)
    },
    "template-literal": (node, emit) => node.exprs.forEach(emit.type),
    "readonly-field": (node, emit) => emit.type(node.field),
    "optional-field": (node, emit) => emit.type(node.field),
    "type-ref": (node, emit) => node.args?.forEach(emit.type),
    application: (node, emit) => {
      emit.type(node.callee)
      node.args.forEach(emit.type)
    },
  },
}
