import { type Block, type Body, type LoopBody, materializeVoid } from "./block.ts"
import type { BindingDeclaration, FunctionDeclaration, TypeDeclaration } from "./declaration.ts"
import {
  type CheckBoolean,
  type CheckLift,
  type Denotes,
  type Expr,
  type Index,
  type Lift,
  lift,
  type Prop,
  type Ref,
  ref,
  type Value,
} from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, makeStatement, type Yieldable } from "./node.ts"
import { type ElementOf, elementType } from "./typing.ts"

export type Statement =
  | BindingDeclaration
  | FunctionDeclaration<any, any, any>
  | TypeDeclaration<any, any>
  | ReturnStatement<any>
  | ThrowStatement
  | ExprStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement
  | WhileStatement
  | ForOfStatement
  | AssignStatement<any, any>

export type Any = Statement

/** statements allowed outside a loop */
export type NonLoopStatement = Exclude<Statement, BreakStatement | ContinueStatement>

/** keeps the node type of what it returns: whether a return widens depends on the expression */
export interface ReturnStatement<E extends Expr<any> = Expr<any>> extends Yieldable {
  readonly kind: "return"
  readonly value: E
}

export const return_ = <const E>(value: E, ..._check: CheckLift<E>): ReturnStatement<Lift<E>> =>
  makeStatement({ kind: "return", value: lift(value as never) as Lift<E> })

export interface ThrowStatement extends Yieldable {
  readonly kind: "throw"
  readonly value: Expr<any>
}

export const throw_ = <const E>(value: E, ..._check: CheckLift<E>): ThrowStatement => makeStatement({ kind: "throw", value: lift(value as never) })

export interface ExprStatement extends Yieldable {
  readonly kind: "expr-statement"
  readonly expr: Expr<any>
}

export const do_ = <const E>(expr: E, ..._check: CheckLift<E>): ExprStatement => makeStatement({ kind: "expr-statement", expr: lift(expr as never) })

/** what can be assigned to */
export type LValue =
  | Ref<any, true>
  | Prop<Expr<any>, string>
  | Index<Expr<readonly unknown[]>, Expr<number>>

type IfEquals<X, Y, Then, Else> = (<U>() => U extends X ? 1 : 2) extends <U>() => U extends Y ? 1 : 2 ? Then : Else

type IsReadonly<O, K extends keyof O> = IfEquals<Pick<O, K>, { -readonly [P in K]: O[P] }, false, true>

type PropWriteType<O, K extends keyof O> = {} extends Pick<O, K> ? O[K] : O[K]

/** the value type accepted when writing a target, or `never` when it is readonly */
export type WriteType<T extends LValue> =
    T extends Prop<infer O, infer K> ? PropWriteType<Denotes<O>, K>
  : T extends Index<infer O, any> ?
      O extends Expr<any[]> ? Denotes<T>
    : never
  : Denotes<T>

type CheckWritable<T extends LValue> =
    T extends Prop<infer O, infer K> ?
      IsReadonly<Denotes<O>, K> extends true ? ["cannot assign to a readonly target"]
    : []
  : [WriteType<T>] extends [never] ? ["cannot assign to a readonly target"]
  : []

export interface AssignStatement<T extends LValue = LValue, V extends Expr<any> = Expr<any>> extends Yieldable {
  readonly kind: "assign"
  readonly target: T
  readonly value: V
}

export const assign = <const T extends LValue, const V>(
  target: T,
  value: V,
  ..._check: [
    ...CheckLift<V>,
    ...CheckWritable<T>,
    ...([Value<V>] extends [WriteType<T>] ? [] : [["the value", Value<V>, "is not assignable to", WriteType<T>]]),
  ]
): AssignStatement<T, Lift<V>> => makeStatement({ kind: "assign", target, value: lift(value as never) as Lift<V> })

export interface BreakStatement extends Yieldable {
  readonly kind: "break"
}

export const break_ = (): BreakStatement => makeStatement({ kind: "break" })

export interface ContinueStatement extends Yieldable {
  readonly kind: "continue"
}

export const continue_ = (): ContinueStatement => makeStatement({ kind: "continue" })

/** the expressions a body's yielded returns hand back */
export type ReturnValue<Y> = Y extends ReturnStatement<infer E> ? E : never

/** the early returns a nested body contributes to its enclosing function's return type */
export type PhantomReturns<B> =
    B extends (...args: any[]) => Generator<infer Y, any, any> ?
      [Extract<Y, ReturnStatement<any>>] extends [never] ? never
    : ReturnStatement<ReturnValue<Y>>
  : never

// Control flow.
//
// `if_`, `while_` and `forOf` hand back a builder rather than a statement. The
// builder holds a spec whose bodies are still generators; they run when the
// builder is yielded, so a builder that is never yielded has no effect.

export interface IfClause {
  readonly condition: Expr<any>
  readonly body: Block
}

export interface IfStatement extends Yieldable {
  readonly kind: "if"
  readonly clauses: ReadonlyArray<IfClause>
  readonly else?: Block | undefined
}

interface IfSpec {
  readonly clauses: ReadonlyArray<{ readonly condition: Expr<any>; readonly body: Body<void, Statement> }>
  readonly else?: Body<void, Statement> | undefined
}

/** `Closed` is phantom: once `else_` has been piped in, no further clause is accepted */
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
      kind: "if",
      clauses: this.spec.clauses.map(({ condition, body }) => ({ condition, body: materializeVoid(body) })),
      else: this.spec.else === undefined ? undefined : materializeVoid(this.spec.else),
    })
    yield statement
  }
}

export const if_ = <const C, const B extends Body<void, Statement>>(
  condition: C,
  body: B,
  ..._check: [...CheckLift<C>, ...CheckBoolean<C>]
): IfBuilder<GeneratorYield<B>> => new IfBuilder({ clauses: [{ condition: lift(condition as never) as Expr<boolean>, body }] })

type GeneratorYield<B> = B extends (...args: any[]) => Generator<infer Y, any, any> ? Y : never

export const elseIf = <const C, const B extends Body<void, Statement>>(
  condition: C,
  body: B,
  ..._check: [...CheckLift<C>, ...CheckBoolean<C>]
) =>
<Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, false> =>
  new IfBuilder({
    ...builder.spec,
    clauses: [...builder.spec.clauses, { condition: lift(condition as never) as Expr<boolean>, body }],
  })

export const else_ = <const B extends Body<void, Statement>>(body: B) => <Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, true> =>
  new IfBuilder({ ...builder.spec, else: body })

export interface WhileStatement extends Yieldable {
  readonly kind: "while"
  readonly condition: Expr<any>
  readonly body: Block
}

interface WhileSpec {
  readonly condition: Expr<any>
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
    const statement: WhileStatement = makeStatement({
      kind: "while",
      condition: this.spec.condition,
      body: materializeVoid(this.spec.body),
    })
    yield statement
  }
}

export const while_ = <const C, const B extends LoopBody<void>>(
  condition: C,
  body: B,
  ..._check: [...CheckLift<C>, ...CheckBoolean<C>]
): WhileBuilder<PhantomReturns<B>> => new WhileBuilder({ condition: lift(condition as never) as Expr<boolean>, body })

/** declares its loop variable, a fresh `const` per iteration */
export interface ForOfStatement extends ValueBinding, Yieldable {
  readonly kind: "for-of"
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr<any>
  readonly body: Block
}

interface ForOfSpec {
  readonly nameHint: string
  readonly iterable: Expr<any>
  readonly body: (item: Ref<any, false>) => Generator<Statement, void, unknown>
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
    const item = ref(id, nameHint, elementType(iterable.type), false, false)
    const statement: ForOfStatement = makeStatement({
      kind: "for-of",
      id,
      nameHint,
      iterable,
      body: materializeVoid(() => body(item)),
    })
    yield statement
  }
}

type CheckIterable<It> = Value<It> extends readonly unknown[] | string ? CheckLift<It> : ["cannot iterate", It]

export const forOf = <
  const Name extends string,
  const It,
  const B extends (item: Ref<ElementOf<Value<It>>, false>) => Generator<Statement, void, unknown>,
>(
  nameHint: Name,
  iterable: It,
  body: B,
  ..._check: CheckIterable<It>
): ForOfBuilder<PhantomReturns<B>> => new ForOfBuilder({ nameHint, iterable: lift(iterable as never), body: body as ForOfSpec["body"] })
