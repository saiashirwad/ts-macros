import { makeNode } from "./node.ts"

/** a sequence of statements */
export interface Block<S = unknown> {
  readonly kind: "block"
  readonly statements: S[]
}

export const block = <S>(statements: S[]): Block<S> => makeNode({ kind: "block", statements })

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
