import {
  type AnyNode,
  type Binding,
  binding,
  type Block,
  type Body,
  type Denotes,
  type Dependencies,
  type DependenciesOf,
  type DependencyEvidence,
  drain,
  type EvidenceDependencies,
  type EvidenceOf,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type RuntimeType,
  type StaticEvidence,
  type Stmt,
  stmt,
  stmtClass,
  type TypeNode,
  typeOperation,
} from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

declare const DeclaredOf: unique symbol
declare const NarrowingOf: unique symbol

export interface Ref<L, D, Declared = D, F extends Facts = { readonly kind: "ref" }, E = StaticEvidence<F>, Dependencies = DependencyEvidence<F>>
  extends Expr<L, D, F, E, Dependencies>
{
  readonly binding: Binding
  readonly [DeclaredOf]: Declared
}

export interface RefNode {
  readonly kind: "ref"
  readonly binding: Binding
  readonly type: RuntimeType
  readonly region?: Binding | undefined
}

const refClass = exprClass<RefNode>({ references: (node) => [node.binding] })

export const ref = <L, D, Declared = D, F extends Facts = { readonly kind: "ref" }, E = StaticEvidence<F>>(
  target: Binding,
  type: RuntimeType,
  region?: Binding,
): Ref<L, D, Declared, F, E> =>
  expr<L, D, { readonly kind: "ref" }, E>(refClass, { kind: "ref", binding: target, region }, type) as Ref<L, D, Declared, F, E>

export interface Narrowing<Then, Else, Declared, FT extends Facts = { readonly kind: "ref" }, FE extends Facts = FT> {
  readonly narrows: Binding
  readonly narrowedType: RuntimeType
  readonly [NarrowingOf]: { readonly then: Then; readonly else: Else; readonly declared: Declared; readonly thenFacts: FT; readonly elseFacts: FE }
}

export type Refined<L, C, Side extends "then" | "else"> = C extends {
  readonly [NarrowingOf]: infer N extends {
    readonly then: unknown
    readonly else: unknown
    readonly declared: unknown
    readonly thenFacts: Facts
    readonly elseFacts: Facts
  }
} ? [Ref<L, N[Side], N["declared"], N[Side extends "then" ? "thenFacts" : "elseFacts"]>]
  : []

const branch = (
  condition: AnyNode,
  side: "then" | "else",
  body: ((...refs: Ref<any, any>[]) => Generator<unknown, void, unknown>) | undefined,
): Block | undefined => {
  if (body === undefined) return undefined
  const subject = (condition as { readonly narrows?: Binding }).narrows
  if (subject === undefined) return drain(body).block
  const region = binding(subject.nameHint)
  return drain(
    () =>
      body(
        ref(
          subject,
          typeOperation({ kind: "refinement", base: (condition as unknown as { narrowedType: RuntimeType }).narrowedType, condition, side }),
          region,
        ),
      ),
    [],
    { subject, region },
  ).block
}

export interface LetNode {
  readonly kind: "let"
  readonly binding: Binding
  readonly type: AnyNode | undefined
  readonly init: AnyNode
}

const letClass = stmtClass<LetNode>({
  children: (node) => [...(node.type === undefined ? [] : [node.type]), node.init],
  declares: (node) => [node.binding],
})

export const letConstruct = <L extends { readonly Assign: TypeLambda }>() => ({
  let: <D, FT extends Facts, I, FI extends Facts, E>(
    nameHint: string,
    init: Expr<L, I, FI, E> & Check<Kind<L["Assign"], [I, D]>, "initializer is not assignable to the declared type", { from: I; to: D }>,
    type: TypeNode<L, D, FT>,
  ): Stmt<
    L,
    { readonly kind: "let" } | FT | FI | EvidenceDependencies<E>,
    Ref<
      L,
      D,
      D,
      { readonly kind: "ref" } | Dependencies<FI | FT | EvidenceDependencies<E>>,
      StaticEvidence<FT> extends "complete" ? E : StaticEvidence<FT>
    >
  > => {
    const declared = binding(nameHint)
    return stmt(
      letClass,
      { kind: "let", binding: declared, type, init },
      ref<
        L,
        D,
        D,
        { readonly kind: "ref" } | Dependencies<FI | FT | EvidenceDependencies<E>>,
        StaticEvidence<FT> extends "complete" ? E : StaticEvidence<FT>
      >(declared, type ?? typeOperation({ kind: "widen", operand: init.type })),
    )
  },
})

export interface AssignNode {
  readonly kind: "assign"
  readonly target: AnyNode
  readonly value: AnyNode
}

const assignClass = stmtClass<AssignNode>({
  children: (node) => [node.target, node.value],
  writes: (node) => [node.target],
})

export const assignConstruct = <L extends { readonly Assign: TypeLambda }>() => ({
  assign: <D, I, FI extends Facts, FT extends Facts, E, ET>(
    target: Ref<L, unknown, D, FT, ET>,
    value: Expr<L, I, FI, E> & Check<Kind<L["Assign"], [I, D]>, "value is not assignable to the binding", { from: I; to: D }>,
  ): Stmt<L, { readonly kind: "assign" | "ref" } | FI | FT | EvidenceDependencies<E> | EvidenceDependencies<ET>> =>
    stmt(assignClass, { kind: "assign", target, value }),
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
  ): Stmt<L, { readonly kind: "if" } | DependenciesOf<E> | FactsOf<Y> | FactsOf<Z> | EvidenceDependencies<EvidenceOf<Y | Z>>> =>
    stmt(ifClass, { kind: "if", condition, then: branch(condition, "then", then as never), else: branch(condition, "else", otherwise as never) }),
})

export interface WhileNode {
  readonly kind: "while"
  readonly condition: AnyNode
  readonly body: Block
}

const whileClass = stmtClass<WhileNode>({ children: (node) => [node.condition, node.body], flow: "loop" })

export const whileConstruct = <L extends { readonly Truthy: TypeLambda }>() => ({
  while: <C, FC extends Facts, Y extends Stmt<L, any, any>, E>(
    condition: Expr<L, C, FC, E> & Check<Kind<L["Truthy"], [C]>, "condition has the wrong type", { condition: C }>,
    body: Body<L, Y>,
  ): Stmt<L, { readonly kind: "while" } | FC | FactsOf<Y> | EvidenceDependencies<E | EvidenceOf<Y>>> =>
    stmt(whileClass, { kind: "while", condition, body: drain(body).block }),
})

export interface ExpressionNode {
  readonly kind: "expression"
  readonly expr: AnyNode
}

const expressionClass = stmtClass<ExpressionNode>({ children: (node) => [node.expr] })

export const expressionConstruct = <L>() => ({
  run: <D, F extends Facts, E>(value: Expr<L, D, F, E>): Stmt<L, { readonly kind: "expression" } | F | EvidenceDependencies<E>> =>
    stmt(expressionClass, { kind: "expression", expr: value }),
})

export const structured = <L extends { readonly Assign: TypeLambda; readonly Truthy: TypeLambda }>() => ({
  ...letConstruct<L>(),
  ...assignConstruct<L>(),
  ...ifConstruct<L>(),
  ...whileConstruct<L>(),
  ...expressionConstruct<L>(),
})
