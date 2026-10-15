declare const LanguageOf: unique symbol
declare const DenotationOf: unique symbol
declare const FactsOfNode: unique symbol
declare const ResultOf: unique symbol
declare const BindingIdType: unique symbol

/** what a node records about itself in its type: at least its kind; constructs may add more */
export interface Facts {
  readonly kind: string
}

/**
 * The kernel's view of a node of language `L`. `L` is any record of capabilities, and it is invariant,
 * so nodes of different languages never mix, even when one language's capabilities extend another's.
 */
export interface Node<L, F extends Facts = Facts> {
  readonly kind: string
  readonly [LanguageOf]: (language: L) => L
  readonly [FactsOfNode]: F
}

/** an expression of `L` whose meaning in `L` is the denotation `D` */
export interface Expr<L, D, F extends Facts = Facts> extends Node<L, F> {
  readonly role: "expr"
  readonly [DenotationOf]: D
}

/** a type of `L` that denotes `D` */
export interface TypeNode<L, D, F extends Facts = Facts> extends Node<L, F> {
  readonly role: "type"
  readonly [DenotationOf]: D
}

/** a statement yields itself, so `yield* statement` appends it to the current block and returns `R` */
export interface Stmt<L, F extends Facts = Facts, R = void> extends Node<L, F> {
  readonly role: "stmt"
  readonly [ResultOf]: R
  [Symbol.iterator](): Generator<Stmt<L, F, R>, R, unknown>
}

export type Denotes<N> = N extends { readonly [DenotationOf]: infer D } ? D : never

/** the facts of every node in `N`; for a body, the union of what it yields */
export type FactsOf<N> = N extends { readonly [FactsOfNode]: infer F } ? F : never

/** every node kind `N` uses, nested kinds included */
export type KindsOf<N> = FactsOf<N> extends infer F ? (F extends Facts ? F["kind"] : never) : never

export type Body<L, Y extends Stmt<L, Facts, any> = Stmt<L, Facts, any>, R = void> = () => Generator<Y, R, unknown>

export type BindingId = string & { readonly [BindingIdType]: true }

/** a declared value with its own identity, whatever it is named */
export interface Binding {
  readonly id: BindingId
  readonly nameHint: string
}

export const binding = (nameHint: string): Binding => ({ id: crypto.randomUUID() as BindingId, nameHint })

/**
 * The runtime half of a construct: what the kernel's walk and scope passes need to know about one node kind.
 * A construct states it once, so the kernel needs no list of node kinds.
 */
export interface Structure<N> {
  /** nodes to walk, in order; a `Block` among them opens a scope */
  readonly children?: (node: N) => ReadonlyArray<AnyNode>
  /** bindings this statement introduces into its enclosing block */
  readonly declares?: (node: N) => ReadonlyArray<Binding>
  /** bindings this node refers to; each must be in scope */
  readonly references?: (node: N) => ReadonlyArray<Binding>
}

const StructureKey = Symbol.for("ts-macros.lang.structure")
const ResultKey = Symbol.for("ts-macros.lang.result")

/** any node at run time: its kind and fields, with the structure its construct gave it */
export interface AnyNode {
  readonly kind: string
  readonly role: "expr" | "type" | "stmt" | "block"
}

/** what every node of one kind shares at run time: its role and its construct's structure */
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

/** the fields of a new node: its kind and whatever its construct stores */
export interface Fields {
  readonly kind: string
  readonly [field: string]: unknown
}

export const expr = <L, D, F extends Facts>(nodeClass: NodeClass<any>, fields: Fields): Expr<L, D, F> =>
  make(nodeClass, fields) as unknown as Expr<L, D, F>

export const typeNode = <L, D, F extends Facts>(nodeClass: NodeClass<any>, fields: Fields): TypeNode<L, D, F> =>
  make(nodeClass, fields) as unknown as TypeNode<L, D, F>

export const stmt = <L, F extends Facts, R = void>(nodeClass: NodeClass<any>, fields: Fields, result?: R): Stmt<L, F, R> =>
  make(nodeClass, fields, result) as unknown as Stmt<L, F, R>

export const structureOf = (node: AnyNode): Structure<AnyNode> =>
  (node as unknown as { readonly [StructureKey]?: Structure<AnyNode> })[StructureKey] ?? {}

export const children = (node: AnyNode): ReadonlyArray<AnyNode> => structureOf(node).children?.(node) ?? []

/** the statements of one body, and the bindings (such as parameters) its scope opens with */
export interface Block {
  readonly kind: "block"
  readonly role: "block"
  readonly binds: ReadonlyArray<Binding>
  readonly statements: ReadonlyArray<AnyNode>
}

const blockClass = classOf<Block>("block", { children: (node) => node.statements })

export interface Drained<R> {
  readonly block: Block
  readonly result: R
}

/** runs a body, collecting what it yields into a block */
export const drain = <R>(body: () => Generator<unknown, R, unknown>, binds: ReadonlyArray<Binding> = []): Drained<R> => {
  const statements: AnyNode[] = []
  const iterator = body()
  while (true) {
    const step = iterator.next()
    if (step.done) return { block: make(blockClass, { kind: "block", binds, statements } as unknown as Block) as Block, result: step.value }
    statements.push(step.value as AnyNode)
  }
}

export const isBlock = (node: AnyNode): node is Block => node.role === "block"

export const walk = (root: AnyNode, visit: (node: AnyNode) => void): void => {
  visit(root)
  children(root).forEach((child) => walk(child, visit))
}
