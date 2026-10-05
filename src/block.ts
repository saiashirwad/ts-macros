import { makeNode } from "./node.ts"
import type { NonLoopStatement, Statement } from "./statement.ts"

export interface Block<S = Statement> {
  readonly kind: "block"
  readonly statements: S[]
}

export const block = <S>(statements: S[]): Block<S> => makeNode({ kind: "block", statements })

export type Body<R = void, Yields extends Statement = NonLoopStatement> = () => Generator<Yields, R, unknown>

export type LoopBody<R = void> = Body<R, Statement>

export interface Drained<R, S> {
  readonly statements: S[]
  readonly result: R
}

export const drain = <S, R>(body: () => Generator<S, R, unknown>): Drained<R, S> => {
  const statements: S[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { statements, result: value }
    statements.push(value)
  }
}

export const materializeVoid = <S>(body: () => Generator<S, void, unknown>): Block<S> => block(drain(body).statements)
