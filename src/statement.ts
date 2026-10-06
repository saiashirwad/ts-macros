import { type Block, type Body, type LoopBody, materializeVoid } from "./block.ts"
import type { BindingDeclaration, FunctionDeclaration, TypeDeclaration } from "./declaration.ts"
import * as Decl from "./declaration.ts"
import {
  type CheckBoolean,
  type CheckContextual,
  type CheckLiftable,
  type Denotes,
  type Expr,
  type Index,
  type IndexWriteType,
  type Lift,
  lift,
  not,
  type Prop,
  type Ref,
  ref,
  type Value,
} from "./expr.ts"
import { type CheckComplement, type Complement, type Guard, initializeAlias } from "./guard.ts"
import { type BindingId, Builder, freshBindingId, makeStatement, type ValueBinding, type Yieldable } from "./node.ts"
import type { Equal, Type } from "./types/index.ts"
import { type ElementOf, elementType, isFresh } from "./typing.ts"

/**
 * Whether the functions in a statement tree have run. A function declaration
 * is "pending" until `build` runs its `impl`, and "built" once it has a
 * `body`; a program's statements are all built.
 */
export type Phase = "pending" | "built"

export type Statement<P extends Phase = Phase> =
  | BindingDeclaration
  | FunctionDeclaration<any, any, any, P>
  | TypeDeclaration<any, any>
  | ReturnStatement<any>
  | ThrowStatement
  | ExprStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement<P>
  | WhileStatement<P>
  | ForOfStatement<P>
  | AssignStatement<any, any>

/** statements allowed outside a loop */
export type NonLoopStatement = Exclude<Statement, BreakStatement | ContinueStatement>

/** keeps the node type of what it returns: whether a return widens depends on the expression */
export interface ReturnStatement<E extends Expr<any> = Expr<any>> extends Yieldable {
  readonly kind: "return"
  readonly value: E
}

const return_ = <const E>(value: E, ..._check: CheckLiftable<E>): ReturnStatement<Lift<E>> =>
  makeStatement({ kind: "return", value: lift(value as never) as Lift<E> })

export interface ThrowStatement extends Yieldable {
  readonly kind: "throw"
  readonly value: Expr<any>
}

const throw_ = <const E>(value: E, ..._check: CheckLiftable<E>): ThrowStatement => makeStatement({ kind: "throw", value: lift(value as never) })

export interface ExprStatement extends Yieldable {
  readonly kind: "expr-statement"
  readonly expr: Expr<any>
}

const do_ = <const E>(expr: E, ..._check: CheckLiftable<E>): ExprStatement => makeStatement({ kind: "expr-statement", expr: lift(expr as never) })

/** what can be assigned to */
export type LValue =
  | Ref<any, true>
  | Prop<Expr<any>, string>
  | Index<Expr<readonly unknown[]>, Expr<number>>

type IsReadonly<O, K extends keyof O> = Equal<Pick<O, K>, { -readonly [P in K]: O[P] }> extends true ? false : true

// Required removes only the implicit undefined of an optional property;
// an explicitly declared undefined remains assignable. Keep receiver unions
// together for each key, then intersect writes through possible keys, just as
// TypeScript checks a union-key access on a union receiver.
type PropWriters<O, K extends keyof O> = K extends keyof O ? (value: Required<Pick<O, K>>[K]) => void : never
type PropWriteType<O, K extends keyof O> = PropWriters<O, K> extends (value: infer Value) => void ? Value : never

/** the value type accepted when writing a target, or `never` when it is readonly */
export type WriteType<T extends LValue> =
    T extends Prop<infer O, infer K> ? PropWriteType<Denotes<O>, K>
  : T extends Index<infer O, infer I> ?
      O extends Expr<any[]> ? IndexWriteType<Denotes<O>, I>
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
    ...CheckLiftable<V>,
    ...CheckWritable<T>,
    ...CheckContextual<Lift<V>, WriteType<T>>,
  ]
): AssignStatement<T, Lift<V>> => makeStatement({ kind: "assign", target, value: lift(value as never) as Lift<V> })

export interface BreakStatement extends Yieldable {
  readonly kind: "break"
}

const break_ = (): BreakStatement => makeStatement({ kind: "break" })

export interface ContinueStatement extends Yieldable {
  readonly kind: "continue"
}

const continue_ = (): ContinueStatement => makeStatement({ kind: "continue" })

/** the expressions a body's yielded returns hand back */
export type ReturnValue<Y> = Y extends ReturnStatement<infer E> ? E : never

/** the early returns a nested body contributes to its enclosing function's return type */
export type PhantomReturns<B> =
    B extends (...args: any[]) => Generator<infer Y, any, any> ?
      [Extract<Y, ReturnStatement<any>>] extends [never] ? never
    : ReturnStatement<ReturnValue<Y>>
  : never

export interface IfClause<P extends Phase = Phase> {
  readonly condition: Expr<any>
  readonly body: Block<Statement<P>>
}

export interface IfStatement<P extends Phase = Phase> extends Yieldable {
  readonly kind: "if"
  readonly clauses: ReadonlyArray<IfClause<P>>
  readonly else?: Block<Statement<P>> | undefined
}

type BindingBody = (binding: Ref<any, false>) => Generator<Statement, void, unknown>

interface ConditionClause {
  readonly condition: Expr<any>
  readonly body: Body<void, Statement>
}

/** a leading clause that tests a guard and binds its narrowed subject */
interface NarrowClause {
  readonly guard: Guard<any>
  readonly body: BindingBody
  readonly nameHint: string
}

/** `if`, any `else if`s, and an optional `else`, possibly led by a guard clause */
interface ChainSpec {
  readonly kind: "chain"
  readonly narrow?: NarrowClause | undefined
  readonly clauses: ReadonlyArray<ConditionClause>
  readonly else?: Body<void, Statement> | undefined
}

/** a guard clause whose `else` binds the subject at the guard's exact complement */
interface ComplementSpec {
  readonly kind: "complement"
  readonly narrow: NarrowClause
  readonly complement: Type<any>
  readonly else: BindingBody
  readonly elseNameHint: string
}

type IfSpec = ChainSpec | ComplementSpec

export class IfBuilder<Yields = never, Closed extends boolean = false> extends Builder {
  declare readonly closed: Closed
  /** makes the yielded statement set invariant so loop-only branches cannot escape their loop */
  declare readonly exactly: (yields: Yields) => Yields
  readonly spec: Closed extends true ? IfSpec : ChainSpec

  constructor(spec: Closed extends true ? IfSpec : ChainSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<BindingDeclaration | IfStatement | Yields, void, unknown> {
    const spec: IfSpec = this.spec
    const clauses: ConditionClause[] = []
    let otherwise = spec.kind === "chain" ? spec.else : undefined
    if (spec.narrow !== undefined) {
      const { guard, body, nameHint } = spec.narrow
      const { subject, condition } = yield* saveSubject(guard)
      clauses.push({
        condition,
        body: function*() {
          yield* body(yield* alias(nameHint, guard.initialize?.(subject) ?? subject, guard.type))
        },
      })
      if (spec.kind === "complement") {
        const { complement, else: rest, elseNameHint } = spec
        otherwise = function*() {
          yield* rest(yield* alias(elseNameHint, initializeAlias(complement, subject), complement))
        }
      }
    }
    if (spec.kind === "chain") clauses.push(...spec.clauses)
    const statement: IfStatement = makeStatement({
      kind: "if",
      clauses: clauses.map(({ condition, body }) => ({ condition, body: materializeVoid(body) })),
      else: otherwise === undefined ? undefined : materializeVoid(otherwise),
    })
    yield statement
  }
}

const if_ = <const C, const B extends Body<void, Statement>>(
  condition: C,
  body: B,
  ..._check: [...CheckLiftable<C>, ...CheckBoolean<C>]
): IfBuilder<GeneratorYield<B>> => new IfBuilder({ kind: "chain", clauses: [{ condition: lift(condition as never) as Expr<boolean>, body }] })

type GeneratorYield<B> = B extends (...args: any[]) => Generator<infer Y, any, any> ? Y : never

const subjectHint = (guard: Guard<any>): string => guard.subject.kind === "ref" ? (guard.subject as Ref<any>).nameHint : "narrowed"

function* saveSubject(guard: Guard<any>): Generator<BindingDeclaration, { readonly subject: Expr<any>; readonly condition: Expr<any> }, unknown> {
  if (guard.subject.kind === "ref") return { subject: guard.subject, condition: guard.condition }
  const subject = yield* (isFresh(guard.subject) ? Decl.const("subject", guard.subject, guard.subject.type!) : Decl.const("subject", guard.subject))
  return { subject, condition: guard.test(subject) }
}

function* alias<A>(nameHint: string, expr: Expr<any>, type: Type<A>): Generator<BindingDeclaration, Ref<A, false>, unknown> {
  const id = freshBindingId()
  yield makeStatement<BindingDeclaration>({ kind: "const-declaration", id, nameHint, expr, annotation: type, type })
  return ref(id, nameHint, type, false, false)
}

/** Only the first guarded clause exposes a complement; ordinary elseIf drops this capability. */
export class GuardedIfBuilder<G extends Guard<any>, Yields = never, Closed extends boolean = false> extends IfBuilder<Yields, Closed> {
  declare readonly guarded: G
  readonly narrow: NarrowClause

  constructor(narrow: NarrowClause) {
    super({ kind: "chain", narrow, clauses: [] })
    this.narrow = narrow
  }

  elseGuard<const B extends (rest: Ref<Complement<G>, false>) => Generator<Statement, void, unknown>>(
    this: GuardedIfBuilder<G, Yields, false>,
    body: B,
    nameHint: string = "rest",
    ..._check: CheckComplement<G>
  ): IfBuilder<Yields | GeneratorYield<B>, true> {
    const { guard } = this.narrow
    if (!("complement" in guard)) throw new Error("elseGuard needs an exact guard complement")
    return new IfBuilder<Yields | GeneratorYield<B>, true>({
      kind: "complement",
      narrow: this.narrow,
      complement: (guard as Guard<any> & { readonly complement: Type<any> }).complement,
      else: body as BindingBody,
      elseNameHint: nameHint,
    })
  }
}

/** tests a guard and passes a fresh, annotated `const` to its successful branch */
export const ifGuard = <
  const G extends Guard<any>,
  const B extends (narrowed: Ref<G extends Guard<infer Out> ? Out : never, false>) => Generator<Statement, void, unknown>,
>(
  guard: G,
  body: B,
  nameHint: string = subjectHint(guard),
): GuardedIfBuilder<G, GeneratorYield<B>> => new GuardedIfBuilder({ guard, body: body as BindingBody, nameHint })

/** A guard clause exposes its failure body's yields just like an if builder. */
export class GuardBuilder<Out, Yields = never> extends Builder {
  declare readonly exactly: (yields: Yields) => Yields
  readonly value: Guard<Out>
  readonly failure: Body<void, Statement>
  readonly nameHint: string

  constructor(value: Guard<Out>, failure: Body<void, Statement>, nameHint: string) {
    super()
    this.value = value
    this.failure = failure
    this.nameHint = nameHint
  }

  *[Symbol.iterator](): Generator<BindingDeclaration | IfStatement | Yields, Ref<Out, false>, unknown> {
    const value = this.value
    const { subject, condition } = yield* saveSubject(value)
    const body = materializeVoid(this.failure)
    const last = body.statements.at(-1)?.kind
    if (last !== "return" && last !== "throw" && last !== "break" && last !== "continue") {
      throw new Error("Stmt.guard failure body must end with return, throw, break, or continue")
    }
    const statement: IfStatement = makeStatement({ kind: "if", clauses: [{ condition: not(condition), body }] })
    yield statement
    return yield* alias(this.nameHint, value.initialize?.(subject) ?? subject, value.type)
  }
}

/** Exits on failure, then returns a fresh annotated const in the enclosing block. */
export const guard = <Out, const B extends Body<void, Statement>>(
  value: Guard<Out>,
  failure: B,
  nameHint: string = subjectHint(value),
): GuardBuilder<Out, GeneratorYield<B>> => new GuardBuilder(value, failure, nameHint)

export const elseIf = <const C, const B extends Body<void, Statement>>(
  condition: C,
  body: B,
  ..._check: [...CheckLiftable<C>, ...CheckBoolean<C>]
) =>
<Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, false> =>
  new IfBuilder({
    ...builder.spec,
    clauses: [...builder.spec.clauses, { condition: lift(condition as never) as Expr<boolean>, body }],
  })

const else_ = <const B extends Body<void, Statement>>(body: B) => <Y>(builder: IfBuilder<Y, false>): IfBuilder<Y | GeneratorYield<B>, true> =>
  new IfBuilder({ ...builder.spec, else: body })

export interface WhileStatement<P extends Phase = Phase> extends Yieldable {
  readonly kind: "while"
  readonly condition: Expr<any>
  readonly body: Block<Statement<P>>
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

const while_ = <const C, const B extends LoopBody<void>>(
  condition: C,
  body: B,
  ..._check: [...CheckLiftable<C>, ...CheckBoolean<C>]
): WhileBuilder<PhantomReturns<B>> => new WhileBuilder({ condition: lift(condition as never) as Expr<boolean>, body })

/** declares its loop variable, a fresh `const` per iteration */
export interface ForOfStatement<P extends Phase = Phase> extends ValueBinding, Yieldable {
  readonly kind: "for-of"
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr<any>
  readonly body: Block<Statement<P>>
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

type CheckIterable<It> = Value<It> extends readonly unknown[] | string ? CheckLiftable<It> : ["cannot iterate", It]

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

export { break_ as break, continue_ as continue, do_ as do, else_ as else, if_ as if, return_ as return, throw_ as throw, while_ as while }
