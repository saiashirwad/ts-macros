// Bodies.
//
// A body is a generator: every statement it yields is appended to its block,
// in order. `drain` runs one; the builders run theirs when they are yielded.

import { makeNode } from "./node.ts"
import type { NonLoopStatement, Statement } from "./statement.ts"

/** a sequence of statements */
export interface Block<S = Statement> {
  readonly kind: "block"
  readonly statements: S[]
}

export const block = <S>(statements: S[]): Block<S> => makeNode({ kind: "block", statements })

/** what a body runs: the statements it yields land where it is `yield*`ed, and it returns `R` */
export type Splice<R = void, Yields extends Statement = NonLoopStatement> = Generator<Yields, R, unknown>

export type Body<R = void, Yields extends Statement = NonLoopStatement> = () => Splice<R, Yields>

/** a loop body may additionally yield `break` and `continue` */
export type LoopBody<R = void> = Body<R, Statement>

export interface Drained<R, S> {
  readonly statements: S[]
  readonly result: R
}

/** runs a body and collects every statement it yields, in order */
export const drain = <S, R>(body: () => Generator<S, R, unknown>): Drained<R, S> => {
  const statements: S[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { statements, result: value }
    statements.push(value)
  }
}

/** runs a body that produces no value */
export const materializeVoid = <S>(body: () => Generator<S, void, unknown>): Block<S> => block(drain(body).statements)
