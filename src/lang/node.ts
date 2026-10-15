declare const LanguageOf: unique symbol
declare const DenotationOf: unique symbol
declare const FactsOfNode: unique symbol
declare const DependenciesEvidence: unique symbol
declare const Evidence: unique symbol
declare const ResultOf: unique symbol
declare const BindingIdType: unique symbol

export interface Facts {
  readonly kind: string
}

export interface Node<L, F extends Facts = Facts, Dependencies = DependencyEvidence<F>> {
  readonly kind: string
  readonly [LanguageOf]: (language: L) => L
  readonly [FactsOfNode]: F
  readonly [DependenciesEvidence]: Dependencies
}

export interface Expr<L, D, F extends Facts = Facts, E = StaticEvidence<F>, Dependencies = DependencyEvidence<F>> extends Node<L, F, Dependencies> {
  readonly role: "expr"
  readonly type: RuntimeType
  readonly [DenotationOf]: D
  readonly [Evidence]: E
}

export type DependencyEvidence<F extends Facts> = "complete" | StaticEvidence<F>
export type DependencyEvidenceOf<N> = N extends { readonly [DependenciesEvidence]: infer D } ? D : "unavailable"

export type StaticEvidence<F extends Facts> =
    0 extends 1 & F ? any
  : string extends F["kind"] ? "complete" | "symbolic" | "unavailable"
  : Extract<F, { readonly runtime: "unavailable" }> extends never ?
      [
        Extract<F, { readonly runtime: "symbolic" }> | Extract<F["kind"], "conditional-type" | "mapped-type" | "intersection-type" | "union-type">,
      ] extends [never] ? "complete"
    : "symbolic"
  : "unavailable"

export type Dependencies<F extends Facts> = string extends F["kind"] ? Unavailable :
  | Extract<F, { readonly runtime: "unavailable" | "symbolic" }>
  | ([Extract<F["kind"], "conditional-type" | "mapped-type" | "intersection-type" | "union-type">] extends [never] ? never
    : { readonly kind: Extract<F["kind"], "conditional-type" | "mapped-type" | "intersection-type" | "union-type"> })

export type EvidenceDependencies<E> =
    0 extends 1 & E ? never
  : [E] extends ["complete"] ? never
  : [E] extends ["complete" | "symbolic"] ? { readonly kind: never; readonly runtime: "symbolic" }
  : Unavailable

export type EvidenceOf<N> = N extends { readonly [Evidence]: infer E } ? E : "unavailable"
export type Unavailable = { readonly kind: "host-value"; readonly runtime: "unavailable" }

export type RuntimeType =
  | { readonly role: "unavailable"; readonly kind: "unavailable" }
  | { readonly role: "type"; readonly kind: string }
  | { readonly role: "type-operation"; readonly kind: "callable"; readonly params: ReadonlyArray<RuntimeType>; readonly returns: RuntimeType }
  | { readonly role: "type-operation"; readonly kind: "widen" | "pointee"; readonly operand: RuntimeType }
  | { readonly role: "type-operation"; readonly kind: "add" | "less"; readonly left: RuntimeType; readonly right: RuntimeType }
  | {
    readonly role: "type-operation"
    readonly kind: "substitution"
    readonly operand: RuntimeType
    readonly environment: ReadonlyMap<Binding, RuntimeType>
  }
  | { readonly role: "type-operation"; readonly kind: "property"; readonly object: RuntimeType; readonly key: string | number }
  | { readonly role: "type-operation"; readonly kind: "call-result"; readonly callee: RuntimeType }
  | {
    readonly role: "type-operation"
    readonly kind: "refinement"
    readonly base: RuntimeType
    readonly condition: AnyNode
    readonly side: "then" | "else"
  }

type OperationFields<T = Extract<RuntimeType, { readonly role: "type-operation" }>> = T extends RuntimeType ? Omit<T, "role"> : never

export const typeOperation = <T extends OperationFields>(fields: T): T & { readonly role: "type-operation" } =>
  Object.freeze(Object.assign({ role: "type-operation" as const }, fields))

export interface TypeNode<L, D, F extends Facts = Facts, E = StaticEvidence<F>, Dependencies = DependencyEvidence<F>>
  extends Node<L, F, Dependencies>
{
  readonly role: "type"
  readonly [Evidence]: E
  readonly [DenotationOf]: D
}

export interface Stmt<L, F extends Facts = Facts, R = void, E = StaticEvidence<F>, Dependencies = DependencyEvidence<F>>
  extends Node<L, F, Dependencies>
{
  readonly role: "stmt"
  readonly [Evidence]: E
  readonly [ResultOf]: R
  [Symbol.iterator](): Generator<Stmt<L, F, R, E>, R, unknown>
}

export type Denotes<N> = N extends { readonly [DenotationOf]: infer D } ? D : never

export type FactsOf<N> = N extends { readonly [FactsOfNode]: infer F } ? F : never

export type DependenciesOf<N> = N extends { readonly kind: string }
  ? FactsOf<N> | EvidenceDependencies<EvidenceOf<N>> | EvidenceDependencies<DependencyEvidenceOf<N>>
  : never

export type KindsOf<N> = FactsOf<N> extends infer F ? (F extends Facts ? F["kind"] : never) : never

export type Body<L, Y extends Stmt<L, Facts, any> = Stmt<L, Facts, any>, R = void> = () => Generator<Y, R, unknown>

export type BindingId = string & { readonly [BindingIdType]: true }

export interface Binding {
  readonly id: BindingId
  readonly nameHint: string
}

export const binding = (nameHint: string): Binding => ({ id: crypto.randomUUID() as BindingId, nameHint })

export interface Structure<N> {
  readonly children?: (node: N) => ReadonlyArray<AnyNode>
  readonly metadata?: (node: N) => ReadonlyArray<AnyNode>
  readonly declares?: (node: N) => ReadonlyArray<Binding>
  readonly references?: (node: N) => ReadonlyArray<Binding>
  readonly writes?: (node: N) => ReadonlyArray<AnyNode>
  readonly flow?: "loop" | "function"
}

const StructureKey = Symbol.for("ts-macros.lang.structure")
const ResultKey = Symbol.for("ts-macros.lang.result")

export interface AnyNode {
  readonly kind: string
  readonly role: "expr" | "type" | "stmt" | "block"
}

export interface NodeClass<N> {
  readonly role: AnyNode["role"]
  readonly prototype: Structure<N>
}

const classOf = <N>(role: AnyNode["role"], structure: Structure<N>): NodeClass<N> => {
  const prototype = Object.create(null)
  Object.defineProperty(prototype, StructureKey, { value: structure })
  if (role === "stmt") {
    Object.defineProperty(prototype, Symbol.iterator, {
      *value(this: { readonly [ResultKey]: unknown }) {
        yield this
        return this[ResultKey]
      },
    })
  }
  return { role, prototype }
}

export const exprClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("expr", structure)
export const typeClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("type", structure)
export const stmtClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("stmt", structure)

const make = <N extends { readonly kind: string }>(nodeClass: NodeClass<N>, fields: N, result?: unknown): N & AnyNode => {
  const node = Object.assign(Object.create(nodeClass.prototype), fields, { role: nodeClass.role })
  if (nodeClass.role === "stmt") Object.defineProperty(node, ResultKey, { value: result })
  return Object.freeze(node)
}

export interface Fields {
  readonly kind: string
  readonly [field: string]: unknown
}

export const expr = <L, D, F extends Facts, E = StaticEvidence<F>>(nodeClass: NodeClass<any>, fields: Fields, type: RuntimeType): Expr<L, D, F, E> =>
  make(nodeClass, { ...fields, type }) as unknown as Expr<L, D, F, E>

export const typeNode = <L, D, F extends Facts>(nodeClass: NodeClass<any>, fields: Fields): TypeNode<L, D, F> =>
  make(nodeClass, fields) as unknown as TypeNode<L, D, F>

export const stmt = <L, F extends Facts, R = void>(nodeClass: NodeClass<any>, fields: Fields, result?: R): Stmt<L, F, R> =>
  make(nodeClass, fields, result) as unknown as Stmt<L, F, R>

export const structureOf = (node: AnyNode): Structure<AnyNode> =>
  (node as unknown as { readonly [StructureKey]?: Structure<AnyNode> })[StructureKey] ?? {}

export const children = (node: AnyNode): ReadonlyArray<AnyNode> => structureOf(node).children?.(node) ?? []

export const metadata = (node: AnyNode): ReadonlyArray<AnyNode> => structureOf(node).metadata?.(node) ?? []

export interface Narrowed {
  readonly subject: Binding
  readonly region: Binding
}

export interface Block {
  readonly kind: "block"
  readonly role: "block"
  readonly binds: ReadonlyArray<Binding>
  readonly statements: ReadonlyArray<AnyNode>
  readonly narrowed?: Narrowed | undefined
}

const blockClass = classOf<Block>("block", { children: (node) => node.statements })

export const scope = (binds: ReadonlyArray<Binding>, statements: ReadonlyArray<AnyNode>, narrowed?: Narrowed): Block =>
  make(blockClass, { kind: "block", binds, statements, narrowed } as unknown as Block) as Block

export interface Drained<R> {
  readonly block: Block
  readonly result: R
}

export const drain = <R>(body: () => Generator<unknown, R, unknown>, binds: ReadonlyArray<Binding> = [], narrowed?: Narrowed): Drained<R> => {
  const statements: AnyNode[] = []
  const iterator = body()
  while (true) {
    const step = iterator.next()
    if (step.done) return { block: scope(binds, statements, narrowed), result: step.value }
    statements.push(step.value as AnyNode)
  }
}

export const isBlock = (node: AnyNode): node is Block => node.role === "block"

export const walk = (root: AnyNode, visit: (node: AnyNode) => void): void => {
  visit(root)
  children(root).forEach((child) => walk(child, visit))
}
