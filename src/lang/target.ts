import type { AnyNode, Binding, BindingId, Block } from "./node.ts"
import { at, frag, type Fragment } from "./print.ts"
import { type Program, visitScopes } from "./program.ts"
import type { Check } from "./rule.ts"

/** what a target knows about the names its language allows */
export interface Naming {
  /** whether a name is a valid identifier, before reserved words are considered */
  readonly valid: (name: string) => boolean
  /** words no binding may be named */
  readonly reserved: ReadonlySet<string>
  /** the target's spelling of a name hint, such as Prolog's uppercase variables; the hint itself by default */
  readonly spell?: (nameHint: string) => string
}

export interface Emitter {
  /** a node's fragment, from the handler for its kind */
  readonly node: (node: AnyNode) => Fragment
  /** a node's text, parenthesized when it binds looser than `min` */
  readonly at: (node: AnyNode, min: number) => string
  /** the emitted lines of each statement in a block, empty ones dropped */
  readonly block: (block: Block) => string[]
  /** a binding's name, unique in its scope and valid for the target */
  readonly name: (binding: Binding) => string
}

/** emits one node kind; a string result binds as tightly as possible */
export type Handler<N = any> = (node: N, emit: Emitter) => Fragment | string

export interface Handlers {
  readonly [kind: string]: Handler
}

/** an open record of handlers by node kind, plus a naming policy */
export interface Target<H extends Handlers = Handlers> {
  readonly naming: Naming
  readonly handlers: H
}

export const defineTarget = <const H extends Handlers>(naming: Naming, handlers: H): Target<H> => ({ naming, handlers })

/** names every binding after its hint, suffixed where a name is reserved or already visible in its scope */
export const bindingNames = (root: Block, naming: Naming): ReadonlyMap<BindingId, string> => {
  const names = new Map<BindingId, string>()
  visitScopes(root, naming.reserved, {
    enter: (bindings, parent) => {
      const used = new Set(parent)
      for (const binding of bindings) {
        const hint = naming.spell?.(binding.nameHint) ?? binding.nameHint
        if (!naming.valid(hint)) throw new Error(`cannot emit invalid identifier "${hint}" for binding "${binding.nameHint}"`)
        let name = hint
        for (let suffix = 2; used.has(name); suffix++) name = `${hint}_${suffix}`
        used.add(name)
        names.set(binding.id, name)
      }
      return used
    },
    reference: () => {},
  })
  return names
}

type Missing<Kinds extends string, H> = Exclude<Kinds, keyof H>

/**
 * Emits a program's top-level statements, one per line. It is a compile-time error unless the target has a
 * handler for every node kind the program uses, nested ones included; a target may handle more.
 */
export const emit = <L, Kinds extends string, const H extends Handlers>(
  program: Program<L, Kinds, any>,
  target: Target<H> & Check<[Missing<Kinds, H>] extends [never] ? true : false, `target has no handler for "${Missing<Kinds, H>}"`>,
): string => {
  const names = bindingNames(program.root, target.naming)
  const emitter: Emitter = {
    node: (node) => {
      const handler = target.handlers[node.kind]
      if (handler === undefined) throw new Error(`target has no handler for "${node.kind}"`)
      const result = handler(node, emitter)
      return typeof result === "string" ? frag(Infinity, result) : result
    },
    at: (node, min) => at(emitter.node(node), min),
    block: (block) => block.statements.map((statement) => emitter.node(statement).text).filter((line) => line !== ""),
    name: (binding) => {
      const name = names.get(binding.id)
      if (name === undefined) throw new Error(`binding "${binding.nameHint}" is not declared in the program`)
      return name
    },
  }
  return emitter.block(program.root).join("\n")
}
