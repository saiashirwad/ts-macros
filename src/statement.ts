import type * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, makeNode, makeStatement, type Yieldable } from "./node.ts"
import * as Type from "./types/index.ts"
import { type ElementOf, elementType } from "./types/lattice.ts"

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
  | AssignStatement<any, any>

export interface Block {
  readonly tag: "block"
  readonly statements: Statement[]
}

export const block = (statements: Statement[]): Block => makeNode({ tag: "block", statements })

/** statements allowed outside a loop */
export type NonLoopStatement = Exclude<Statement, BreakStatement | ContinueStatement>

/** a body is a generator: every statement it yields is appended to the block, in order */
export type Body<R = void, Yields extends Statement = NonLoopStatement> = () => Generator<Yields, R, unknown>

/** a loop body may additionally yield `break` and `continue` */
export type LoopBody<R = void> = Body<R, Statement>

/** keeps the node type of what it returns, not just what that denotes: whether a return widens depends on the expression */
export interface ReturnStatement<E extends Expr.Expr<any> = Expr.Expr<any>> extends Yieldable {
  readonly tag: "return"
  readonly value: E
}

export const Return = <E extends Expr.Expr<any>>(value: E): ReturnStatement<E> => makeStatement({ tag: "return", value })

export interface ThrowStatement extends Yieldable {
  readonly tag: "throw"
  readonly value: Expr.Expr<any>
}

export const Throw = (value: Expr.Expr<any>): ThrowStatement => makeStatement({ tag: "throw", value })

export interface ExprStatement extends Yieldable {
  readonly tag: "expr-statement"
  readonly expr: Expr.Expr<any>
}

export const Do = (expr: Expr.Expr<any>): ExprStatement => makeStatement({ tag: "expr-statement", expr })

/** what can be assigned to */
export type LValue =
  | Expr.VarRef<any, true>
  | (Expr.Expr<any> & { readonly tag: "prop" })
  | (Expr.Expr<any> & { readonly tag: "index" })

type IfEquals<X, Y, Then, Else> = (<U>() => U extends X ? 1 : 2) extends <U>() => U extends Y ? 1 : 2 ? Then : Else

type IsReadonly<O, K extends keyof O> = IfEquals<Pick<O, K>, { -readonly [P in K]: O[P] }, false, true>

type PropWriteType<O, K extends keyof O> = {} extends Pick<O, K> ? O[K] : O[K]
/** the value type accepted when writing a target, or `never` when it is readonly */
export type WriteType<T extends LValue> =
    T extends Expr.Prop<infer O, infer K> ? PropWriteType<Expr.Denotes<O>, K>
  : T extends Expr.Index<infer O, any> ?
      O extends Expr.Expr<any[]> ? Expr.Denotes<T>
    : never
  : Expr.Denotes<T>

export interface AssignStatement<T extends LValue = LValue, V extends Expr.Expr<WriteType<T>> = Expr.Expr<any>> extends Yieldable {
  readonly tag: "assign"
  readonly target: T
  readonly value: V
}

type CheckWritable<T extends LValue> =
    T extends Expr.Prop<infer O, infer K> ?
      IsReadonly<Expr.Denotes<O>, K> extends true ? ["cannot assign to a readonly target"]
    : []
  : [WriteType<T>] extends [never] ? ["cannot assign to a readonly target"]
  : []

export const Assign = <const T extends LValue, const V extends Expr.Expr<WriteType<T>>>(
  target: T,
  value: V,
  ..._check: CheckWritable<T>
): AssignStatement<T, V> => makeStatement({ tag: "assign", target, value })

export interface BreakStatement extends Yieldable {
  readonly tag: "break"
}

export const Break = (): BreakStatement => makeStatement({ tag: "break" })

export interface ContinueStatement extends Yieldable {
  readonly tag: "continue"
}

export const Continue = (): ContinueStatement => makeStatement({ tag: "continue" })

export interface Drained<R> {
  readonly statements: Statement[]
  readonly result: R
}

/** runs a body and collects every statement it yields, in order */
export const drain = <Yields extends Statement, R>(body: () => Generator<Yields, R, unknown>): Drained<R> => {
  const statements: Statement[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { statements, result: value }
    statements.push(value)
  }
}

export const materializeVoid = <Yields extends Statement>(body: Body<void, Yields>): Block => block(drain(body).statements)

/** drains a body whose return value becomes a trailing `return` statement */
export const materializeValue = <Yields extends Statement>(body: Body<Expr.Expr<any>, Yields>): Block => {
  const { statements, result } = drain(body)
  return block([...statements, Return(result)])
}

/** the expressions a body's yielded `Return`s hand back */
export type ReturnValue<Y> = Y extends ReturnStatement<infer E> ? E : never

/** the early returns a nested body contributes to its enclosing function's return type */
export type PhantomReturns<B> =
    B extends (...args: any[]) => Generator<infer Y, any, any> ?
      [Extract<Y, ReturnStatement<any>>] extends [never] ? never
    : ReturnStatement<ReturnValue<Y>>
  : never

// Control flow.
//
// `If`, `While` and `ForOf` hand back a builder rather than a statement. The
// builder holds a spec whose bodies are still generators; they run when the
// builder is yielded, so a builder that is never yielded has no effect. Its
// `Yields` parameter carries the early returns of those bodies up to the
// enclosing function.

export interface IfClause {
  readonly condition: Expr.Expr<any>
  readonly body: Block
}

export interface IfStatement {
  readonly tag: "if"
  readonly clauses: ReadonlyArray<IfClause>
  readonly else?: Block | undefined
}

interface IfSpec {
  readonly clauses: ReadonlyArray<{ readonly condition: Expr.Expr<any>; readonly body: Body<void, Statement> }>
  readonly else?: Body<void, Statement> | undefined
}

/** `Closed` is phantom: once `Else` has been piped in, no further clause is accepted */
export class IfBuilder<Yields = never, Closed extends boolean = false> extends Builder {
  declare readonly closed: Closed
  /** makes the yielded statement set invariant so loop-only branches cannot escape their loop */
  declare readonly exactly: (yields: Yields) => Yields
  readonly spec: IfSpec

  constructor(spec: IfSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<IfStatement | Yields, void, unknown> {
    const statement: IfStatement = makeStatement({
      tag: "if",
      clauses: this.spec.clauses.map(({ condition, body }) => ({ condition, body: materializeVoid(body) })),
      else: this.spec.else === undefined ? undefined : materializeVoid(this.spec.else),
    })
    yield statement
  }
}

export const If = <const C extends Expr.Expr<boolean>, const B extends Body<void, Statement>>(
  condition: C,
  body: B,
): IfBuilder<GeneratorYield<B>> => new IfBuilder({ clauses: [{ condition, body }] })

type GeneratorYield<B> = B extends (...args: any[]) => Generator<infer Y, any, any> ? Y : never

export const ElseIf =
  <const C extends Expr.Expr<boolean>, const B extends Body<void, Statement>>(condition: C, body: B) =>
  <Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, false> =>
    new IfBuilder({ ...builder.spec, clauses: [...builder.spec.clauses, { condition, body }] })

export const Else = <const B extends Body<void, Statement>>(body: B) => <Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, true> =>
  new IfBuilder({ ...builder.spec, else: body })

export interface WhileStatement {
  readonly tag: "while"
  readonly condition: Expr.Expr<any>
  readonly body: Block
}

interface WhileSpec {
  readonly condition: Expr.Expr<any>
  readonly body: LoopBody<void>
}

export class WhileBuilder<Yields = never> extends Builder {
  /** a loop exposes only nested returns to its enclosing body */
  declare readonly yields: Yields
  readonly spec: WhileSpec

  constructor(spec: WhileSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<WhileStatement | Yields, void, unknown> {
    const statement: WhileStatement = makeStatement({ tag: "while", condition: this.spec.condition, body: materializeVoid(this.spec.body) })
    yield statement
  }
}

export const While = <const C extends Expr.Expr<boolean>, const B extends LoopBody<void>>(condition: C, body: B): WhileBuilder<PhantomReturns<B>> =>
  new WhileBuilder({ condition, body })

/** declares its loop variable, a fresh `const` per iteration */
export interface ForOfStatement extends ValueBinding {
  readonly tag: "for-of"
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr.Expr<any>
  readonly body: Block
}

interface ForOfSpec {
  readonly nameHint: string
  readonly iterable: Expr.Expr<any>
  readonly body: (item: Expr.VarRef<any, false>) => Generator<Statement, void, unknown>
}

export class ForOfBuilder<Yields = never> extends Builder {
  /** a loop exposes only nested returns to its enclosing body */
  declare readonly yields: Yields
  readonly spec: ForOfSpec

  constructor(spec: ForOfSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<ForOfStatement | Yields, void, unknown> {
    const { nameHint, iterable, body } = this.spec
    const id = freshBindingId()
    const item = Expr.VarRef(id, nameHint, elementType(iterable.type), false, false)
    const statement: ForOfStatement = makeStatement({ tag: "for-of", id, nameHint, iterable, body: materializeVoid(() => body(item)) })
    yield statement
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
): ForOfBuilder<PhantomReturns<B>> => new ForOfBuilder({ nameHint, iterable, body })
