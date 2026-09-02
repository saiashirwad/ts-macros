import type * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, makePipeable, makeYieldable, type Yieldable } from "./pipeable.ts"
import * as Type from "./types/index.ts"
import { elementType, lub, widen } from "./types/lattice.ts"

export type Statement =
  | Binding.BindingDeclaration
  | Fn.FunctionDeclaration<any, any, any>
  | Type.TypeDeclaration<any, any>
  | ReturnStatement<any>
  | ThrowStatement
  | ExprStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement
  | WhileStatement
  | ForOfStatement
  | Expr.Assign<any, any>

export interface Block {
  readonly tag: "block"
  readonly statements: Statement[]
}

export const block = (statements: Statement[]): Block => makePipeable({ tag: "block", statements })

export type Body<R = void> = () => Generator<Statement, R, unknown>

export interface ReturnStatement<A = unknown> extends Yieldable {
  readonly tag: "return"
  readonly value: Expr.Expr<A>
}

export const Return = <const A>(value: Expr.Expr<A>): ReturnStatement<A> => makeYieldable({ tag: "return", value })

export interface ThrowStatement extends Yieldable {
  readonly tag: "throw"
  readonly value: Expr.Expr<any>
}

export const Throw = (value: Expr.Expr<any>): ThrowStatement => makeYieldable({ tag: "throw", value })

export interface ExprStatement extends Yieldable {
  readonly tag: "expr-statement"
  readonly expr: Expr.Expr<any>
}

export const Do = (expr: Expr.Expr<any>): ExprStatement => makeYieldable({ tag: "expr-statement", expr })

export interface BreakStatement extends Yieldable {
  readonly tag: "break"
}

export const Break = (): BreakStatement => makeYieldable({ tag: "break" })

export interface ContinueStatement extends Yieldable {
  readonly tag: "continue"
}

export const Continue = (): ContinueStatement => makeYieldable({ tag: "continue" })

const TERMINAL: ReadonlySet<string> = new Set(["return", "throw", "break", "continue"])

/**
 * Runs a body and collects the statements it yields. Draining stops after a
 * terminal statement, since nothing after it is reachable; `result` is the
 * body's return value, or undefined when it never returned.
 */
export interface Drained<R> {
  readonly statements: Statement[]
  readonly result: R | undefined
}

export const drain = <Yields extends Statement, R>(body: () => Generator<Yields, R, unknown>): Drained<R> => {
  const statements: Statement[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { statements, result: value }
    statements.push(value)
    if (TERMINAL.has(value.tag)) return { statements, result: undefined }
  }
}

export const materializeVoid = (body: Body<void>): Block => block(drain(body).statements)

/** drains a body whose return value becomes a trailing `return` statement */
export const materializeValue = (body: Body<Expr.Expr<any>>): Block => {
  const { statements, result } = drain(body)
  return block(result === undefined ? statements : [...statements, Return(result)])
}

/**
 * The return type of a block: void when nothing returns, otherwise the union
 * of every returned value's widened type; undefined if any of them is untyped.
 */
export const returnType = (root: Block): Type.TypeExpr<any> | undefined => {
  const values: Expr.Expr<any>[] = []
  const visit = (statements: ReadonlyArray<Statement>): void => {
    for (const statement of statements) {
      if (statement.tag === "return") {
        values.push(statement.value)
      } else if (statement.tag === "if") {
        statement.clauses.forEach((clause) => visit(clause.body.statements))
        if (statement.else !== null) visit(statement.else.statements)
      } else if (statement.tag === "while" || statement.tag === "for-of") {
        visit(statement.body.statements)
      }
    }
  }
  visit(root.statements)
  if (values.length === 0) return Type.Void()
  const types = values.map((value) => value.type)
  return types.every((type) => type !== undefined) ? lub(types.map((type) => widen(type!))) : undefined
}

export type ReturnValue<Y> = Y extends ReturnStatement<infer A> ? A : never

export type BodyReturns<B> = B extends (...args: any[]) => Generator<infer Y, any, any> ? ReturnValue<Y> : never

/** the early returns a nested body contributes to its enclosing function's return type */
export type PhantomReturns<B> =
    B extends (...args: any[]) => Generator<infer Y, any, any> ?
      [Extract<Y, ReturnStatement<any>>] extends [never] ? never
    : ReturnStatement<ReturnValue<Y>>
  : never

export interface IfClause {
  readonly condition: Expr.Expr<any>
  readonly body: Block
}

export interface IfStatement {
  readonly tag: "if"
  readonly clauses: ReadonlyArray<IfClause>
  readonly else: Block | null
}

interface IfClauseSpec {
  readonly condition: Expr.Expr<any>
  readonly body: Body<void>
}

interface IfSpec {
  readonly clauses: ReadonlyArray<IfClauseSpec>
  readonly elseBody: Body<void> | null
}

/** bodies are kept as generators and only run when the builder is yielded */
export class IfBuilder<Yields = never, Closed extends boolean = false> extends Builder {
  declare readonly closed: Closed
  readonly spec: IfSpec

  constructor(spec: IfSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<IfStatement | Yields, void, unknown> {
    yield makeYieldable({
      tag: "if" as const,
      clauses: this.spec.clauses.map(({ condition, body }) => ({ condition, body: materializeVoid(body) })),
      else: this.spec.elseBody === null ? null : materializeVoid(this.spec.elseBody),
    })
  }
}

export const If = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(condition: C, body: B): IfBuilder<PhantomReturns<B>> =>
  new IfBuilder({ clauses: [{ condition, body }], elseBody: null })

export const ElseIf =
  <const C extends Expr.Expr<boolean>, const B extends Body<void>>(condition: C, body: B) =>
  <Y>({ spec: { clauses, ...spec } }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, false> =>
    new IfBuilder({ ...spec, clauses: [...clauses, { condition, body }] })

export const Else = <const B extends Body<void>>(elseBody: B) => <Y>({ spec }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, true> =>
  new IfBuilder({ ...spec, elseBody })

export interface WhileStatement {
  readonly tag: "while"
  readonly condition: Expr.Expr<any>
  readonly body: Block
}

export class WhileBuilder<Yields = never> extends Builder {
  readonly statement: WhileStatement

  constructor(statement: WhileStatement) {
    super()
    this.statement = statement
  }

  *[Symbol.iterator](): Generator<WhileStatement | Yields, void, unknown> {
    yield this.statement
  }
}

export const While = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(condition: C, body: B): WhileBuilder<PhantomReturns<B>> =>
  new WhileBuilder(makeYieldable({ tag: "while" as const, condition, body: materializeVoid(body) }))

/**
 * the element type a for-of loop variable should denote
 *
 * a readonly tuple (`[1, 2] as const`) keeps its literal elements; any other
 * array widens them, as `const xs = [1, 2]` does in TypeScript
 */
export type ElementOf<A> =
    A extends unknown[] ? Expr.Widen<A[number]>
  : A extends readonly unknown[] ? A[number]
  : A extends string ? string
  : never

export interface ForOfStatement extends ValueBinding {
  readonly tag: "for-of"
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr.Expr<any>
  readonly body: Block
}

export class ForOfBuilder<Yields = never> extends Builder {
  readonly statement: ForOfStatement

  constructor(statement: ForOfStatement) {
    super()
    this.statement = statement
  }

  *[Symbol.iterator](): Generator<ForOfStatement | Yields, void, unknown> {
    yield this.statement
  }
}

export const ForOf = <
  const Name extends string,
  const It extends Expr.Expr<ReadonlyArray<unknown> | string>,
  const B extends (item: Expr.VarRef<ElementOf<Expr.Denotes<It>>, false>) => Generator<Statement, void, unknown>,
>(
  nameHint: Name,
  iterable: It,
  body: B,
): ForOfBuilder<PhantomReturns<B>> => {
  const id = freshBindingId()
  const item = Expr.LocalRef<any, false>(id, nameHint, elementType(iterable.type))
  return new ForOfBuilder(makeYieldable({ tag: "for-of" as const, id, nameHint, iterable, body: materializeVoid(() => body(item)) }))
}
