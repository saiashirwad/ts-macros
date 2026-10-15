import {
  type AnyNode,
  type Binding,
  binding,
  type Block,
  type Body,
  type Denotes,
  drain,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type Stmt,
  stmt,
  stmtClass,
  type TypeNode,
} from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

declare const DeclaredOf: unique symbol
declare const NarrowingOf: unique symbol

export interface Ref<L, D, Declared = D> extends Expr<L, D, { readonly kind: "ref" }> {
  readonly binding: Binding
  readonly [DeclaredOf]: Declared
}

export interface RefNode {
  readonly kind: "ref"
  readonly binding: Binding
  readonly region?: Binding | undefined
}

const refClass = exprClass<RefNode>({ references: (node) => [node.binding] })

export const ref = <L, D, Declared = D>(target: Binding, region?: Binding): Ref<L, D, Declared> =>
  expr<L, D, { readonly kind: "ref" }>(refClass, { kind: "ref", binding: target, region }) as Ref<L, D, Declared>

export interface Narrowing<Then, Else, Declared> {
  readonly narrows: Binding
  readonly [NarrowingOf]: { readonly then: Then; readonly else: Else; readonly declared: Declared }
}

export type Refined<L, C, Side extends "then" | "else"> = C extends
  { readonly [NarrowingOf]: infer N extends { readonly then: unknown; readonly else: unknown; readonly declared: unknown } }
  ? [Ref<L, N[Side], N["declared"]>]
  : []

const branch = (condition: AnyNode, body: ((...refs: Ref<any, any>[]) => Generator<unknown, void, unknown>) | undefined): Block | undefined => {
  if (body === undefined) return undefined
  const subject = (condition as { readonly narrows?: Binding }).narrows
  if (subject === undefined) return drain(body).block
  const region = binding(subject.nameHint)
  return drain(() => body(ref(subject, region)), [], { subject, region }).block
}

export interface LetNode {
  readonly kind: "let"
  readonly binding: Binding
  readonly type: AnyNode
  readonly init: AnyNode
}

const letClass = stmtClass<LetNode>({ children: (node) => [node.type, node.init], declares: (node) => [node.binding] })

export const letConstruct = <L extends { readonly Assign: TypeLambda }>() => ({
  let: <D, FT extends Facts, I, FI extends Facts>(
    type: TypeNode<L, D, FT>,
    nameHint: string,
    init: Expr<L, I, FI> & Check<Kind<L["Assign"], [I, D]>, "initializer is not assignable to the declared type", { from: I; to: D }>,
  ): Stmt<L, { readonly kind: "let" } | FT | FI, Ref<L, D>> => {
    const declared = binding(nameHint)
    return stmt(letClass, { kind: "let", binding: declared, type, init }, ref<L, D>(declared))
  },
})

export interface AssignNode {
  readonly kind: "assign"
  readonly target: AnyNode
  readonly value: AnyNode
}

const assignClass = stmtClass<AssignNode>({
  children: (node) => [node.target, node.value],
  writes: (node) => [(node.target as unknown as RefNode).binding],
})

export const assignConstruct = <L extends { readonly Assign: TypeLambda }>() => ({
  assign: <D, I, FI extends Facts>(
    target: Ref<L, unknown, D>,
    value: Expr<L, I, FI> & Check<Kind<L["Assign"], [I, D]>, "value is not assignable to the binding", { from: I; to: D }>,
  ): Stmt<L, { readonly kind: "assign" | "ref" } | FI> => stmt(assignClass, { kind: "assign", target, value }),
})

export interface IfNode {
  readonly kind: "if"
  readonly condition: AnyNode
  readonly then: Block
  readonly else: Block | undefined
}

const ifClass = stmtClass<IfNode>({ children: (node) => [node.condition, node.then, ...(node.else === undefined ? [] : [node.else])] })

export const ifConstruct = <L extends { readonly Truthy: TypeLambda }>() => ({
  if: <E extends Expr<L, any, any>, Y extends Stmt<L, any, any>, Z extends Stmt<L, any, any> = never>(
    condition: E & Check<Kind<L["Truthy"], [Denotes<E>]>, "condition has the wrong type", { condition: Denotes<E> }>,
    then: (...refs: Refined<L, E, "then">) => Generator<Y, void, unknown>,
    otherwise?: (...refs: Refined<L, E, "else">) => Generator<Z, void, unknown>,
  ): Stmt<L, { readonly kind: "if" } | FactsOf<E> | FactsOf<Y> | FactsOf<Z>> =>
    stmt(ifClass, { kind: "if", condition, then: branch(condition, then as never), else: branch(condition, otherwise as never) }),
})

export interface WhileNode {
  readonly kind: "while"
  readonly condition: AnyNode
  readonly body: Block
}

const whileClass = stmtClass<WhileNode>({ children: (node) => [node.condition, node.body], flow: "loop" })

export const whileConstruct = <L extends { readonly Truthy: TypeLambda }>() => ({
  while: <C, FC extends Facts, Y extends Stmt<L, any, any>>(
    condition: Expr<L, C, FC> & Check<Kind<L["Truthy"], [C]>, "condition has the wrong type", { condition: C }>,
    body: Body<L, Y>,
  ): Stmt<L, { readonly kind: "while" } | FC | FactsOf<Y>> => stmt(whileClass, { kind: "while", condition, body: drain(body).block }),
})

export interface ExpressionNode {
  readonly kind: "expression"
  readonly expr: AnyNode
}

const expressionClass = stmtClass<ExpressionNode>({ children: (node) => [node.expr] })

export const expressionConstruct = <L>() => ({
  run: <D, F extends Facts>(value: Expr<L, D, F>): Stmt<L, { readonly kind: "expression" } | F> =>
    stmt(expressionClass, { kind: "expression", expr: value }),
})

export const structured = <L extends { readonly Assign: TypeLambda; readonly Truthy: TypeLambda }>() => ({
  ...letConstruct<L>(),
  ...assignConstruct<L>(),
  ...ifConstruct<L>(),
  ...whileConstruct<L>(),
  ...expressionConstruct<L>(),
})
