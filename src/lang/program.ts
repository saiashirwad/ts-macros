import { type AnyNode, type Binding, type BindingId, type Block, children, drain, isBlock, type KindsOf, type Stmt, structureOf } from "./node.ts"

declare const ProgramLanguage: unique symbol
declare const ProgramKinds: unique symbol

export interface Program<L, Kinds extends string = string, R = void> {
  readonly [ProgramLanguage]: (language: L) => L
  readonly [ProgramKinds]: Kinds
  readonly root: Block
  readonly result: R
}

export interface ScopeVisitor<Scope> {
  enter(bindings: ReadonlyArray<Binding>, parent: Scope): Scope
  reference(reference: Binding, scope: Scope): void
}

export const visitScopes = <Scope>(root: Block, initial: Scope, visitor: ScopeVisitor<Scope>): void => {
  const visitBlock = (block: Block, parent: Scope): void => {
    const declared = block.statements.flatMap((statement) => structureOf(statement).declares?.(statement) ?? [])
    const scope = visitor.enter([...block.binds, ...declared], parent)
    block.statements.forEach((statement) => visit(statement, scope))
  }
  const visit = (node: AnyNode, scope: Scope): void => {
    if (isBlock(node)) return visitBlock(node, scope)
    for (const reference of structureOf(node).references?.(node) ?? []) visitor.reference(reference, scope)
    children(node).forEach((child) => visit(child, scope))
  }
  visitBlock(root, initial)
}

export const validateScopes = (root: Block): void => {
  const declared = new Set<BindingId>()
  visitScopes(root, new Set<BindingId>(), {
    enter: (bindings, parent) => {
      const visible = new Set(parent)
      for (const binding of bindings) {
        if (declared.has(binding.id)) throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
        declared.add(binding.id)
        visible.add(binding.id)
      }
      return visible
    },
    reference: (reference, visible) => {
      if (!visible.has(reference.id)) {
        throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding (scope extrusion is checked at build time)`)
      }
    },
  })
}

type Reference = { readonly binding?: Binding; readonly region?: Binding }

export const validateNarrowing = (root: Block): void => {
  const invalid = new Set<BindingId>()
  const targets = (node: AnyNode): ReadonlyArray<AnyNode> => structureOf(node).writes?.(node) ?? []
  const written = (node: AnyNode): ReadonlyArray<AnyNode> => [...targets(node), ...children(node).flatMap(written)]
  const visit = (node: AnyNode, active: ReadonlyMap<BindingId, Binding>, outside: ReadonlySet<BindingId>, writing: boolean): void => {
    const structure = structureOf(node)
    const { binding: used, region } = node as unknown as Reference
    if (!writing && node.kind === "ref" && region !== undefined && used !== undefined) {
      if (!active.has(region.id)) throw new Error(`a narrowed reference to "${used.nameHint}" is used outside the branch that narrowed it`)
      if (outside.has(region.id)) {
        throw new Error(`a narrowed reference to "${used.nameHint}" is used in a function nested in the branch that narrowed it`)
      }
      if (invalid.has(region.id)) {
        throw new Error(`a narrowed reference to "${used.nameHint}" is used after "${used.nameHint}" may have been assigned`)
      }
    }
    const invalidate = (nodes: ReadonlyArray<AnyNode>) => {
      for (const [id, subject] of active) if (nodes.some((target) => (target as unknown as Reference).binding?.id === subject.id)) invalid.add(id)
    }
    if (structure.flow === "loop") invalidate(written(node))
    const narrowed = isBlock(node) ? node.narrowed : undefined
    const inner = narrowed === undefined ? active : new Map([...active, [narrowed.region.id, narrowed.subject]])
    const enclosing = structure.flow === "function" ? new Set(active.keys()) : outside
    children(node).forEach((child) => visit(child, inner, enclosing, targets(node).includes(child)))
    invalidate(targets(node))
  }
  visit(root, new Map(), new Set(), false)
}

export interface Language {
  readonly name: string
}

export const builder =
  <L extends Language>() => <Y extends Stmt<L, any, any>, R = void>(body: () => Generator<Y, R, unknown>): Program<L, KindsOf<Y>, R> => {
    const { block, result } = drain(body)
    validateScopes(block)
    validateNarrowing(block)
    return { root: block, result } as unknown as Program<L, KindsOf<Y>, R>
  }
