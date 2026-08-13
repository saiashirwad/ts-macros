import type * as Binding from "./binding.ts"
import type * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import { type CheckLift, type Denote, type In, norm } from "./norm.ts"
import { makePipeable, makeYieldable, PipeableClass, type Yieldable } from "./pipeable.ts"
import type * as Type from "./types/index.ts"

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

export type Body<R = void> = () => Generator<Statement, R, unknown>

export interface ReturnStatement<A = unknown> extends Yieldable {
  readonly tag: "return"
  readonly value: Expr.Expr<A>
}

export const Return = <const X>(value: X, ..._check: CheckLift<X>): ReturnStatement<Denote<X>> =>
  makeYieldable({ tag: "return", value: norm(value as any) })

export interface ThrowStatement extends Yieldable {
  readonly tag: "throw"
  readonly value: Expr.Expr<any>
}

export const Throw = (value: In<any>): ThrowStatement => makeYieldable({ tag: "throw", value: norm(value as any) })

export interface ExprStatement extends Yieldable {
  readonly tag: "expr-statement"
  readonly expr: Expr.Expr<any>
}

export const Do = (expr: In<any>): ExprStatement => makeYieldable({ tag: "expr-statement", expr: norm(expr) })

export interface BreakStatement extends Yieldable {
  readonly tag: "break"
}

export const Break = (): BreakStatement => makeYieldable({ tag: "break" })

export interface ContinueStatement extends Yieldable {
  readonly tag: "continue"
}

export const Continue = (): ContinueStatement => makeYieldable({ tag: "continue" })

const TERMINAL_TAGS: ReadonlySet<string> = new Set(["return", "throw", "break", "continue"])

export function materializeVoid(body: Body<void>): Block {
  const statements: Statement[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { tag: "block", statements }
    statements.push(value)
    if (TERMINAL_TAGS.has(value.tag)) return { tag: "block", statements }
  }
}

export function materializeValue(body: () => Generator<Statement, In<any>, unknown>): Block {
  const statements: Statement[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) {
      statements.push(Return(value))
      return { tag: "block", statements }
    }
    statements.push(value)
    if (TERMINAL_TAGS.has(value.tag)) return { tag: "block", statements }
  }
}

export type ReturnValue<Y> = Y extends ReturnStatement<infer A> ? A : never

export type BodyReturns<B> = B extends (...args: any[]) => Generator<infer Y, any, any> ? ReturnValue<Y> : never

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

export class IfBuilder<Yields = never, Closed extends boolean = false> extends PipeableClass() {
  declare readonly closed: Closed
  readonly spec: IfSpec

  constructor(spec: IfSpec) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<IfStatement | Yields, void, unknown> {
    yield {
      tag: "if",
      clauses: this.spec.clauses.map(({ condition, body }) => ({
        condition,
        body: materializeVoid(body),
      })),
      else: this.spec.elseBody === null ? null : materializeVoid(this.spec.elseBody),
    }
  }

  elseif<const B extends Body<void>>(this: IfBuilder<Yields, false>, condition: In<boolean>, body: B): IfBuilder<Yields | PhantomReturns<B>, false> {
    return new IfBuilder({ ...this.spec, clauses: [...this.spec.clauses, { condition: norm(condition), body }] })
  }

  else<const B extends Body<void>>(this: IfBuilder<Yields, false>, body: B): IfBuilder<Yields | PhantomReturns<B>, true> {
    return new IfBuilder({ ...this.spec, elseBody: body })
  }
}

export const If = <const B extends Body<void>>(
  condition: In<boolean>,
  body: B,
): IfBuilder<PhantomReturns<B>> => new IfBuilder({ clauses: [{ condition: norm(condition), body }], elseBody: null })

export const ElseIf = <const B extends Body<void>>(
  condition: In<boolean>,
  body: B,
) =>
<Y>({ spec: { clauses, ...spec } }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, false> =>
  new IfBuilder({ ...spec, clauses: [...clauses, { condition: norm(condition), body }] })

export const Else = <const B extends Body<void>>(elseBody: B) => <Y>({ spec }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, true> =>
  new IfBuilder({ ...spec, elseBody })

export interface WhileStatement {
  readonly tag: "while"
  readonly condition: Expr.Expr<any>
  readonly body: Block
}

export class WhileBuilder<Yields = never> extends PipeableClass() {
  readonly statement: WhileStatement

  constructor(statement: WhileStatement) {
    super()
    this.statement = statement
  }

  *[Symbol.iterator](): Generator<WhileStatement | Yields, void, unknown> {
    yield this.statement
  }
}

export const While = <const B extends Body<void>>(
  condition: In<boolean>,
  body: B,
): WhileBuilder<PhantomReturns<B>> => new WhileBuilder({ tag: "while", condition: norm(condition), body: materializeVoid(body) })

export type ElementOf<A> =
    A extends ReadonlyArray<infer E> ? E
  : A extends string ? string
  : never

export interface ForOfStatement {
  readonly tag: "for-of"
  readonly name: string
  readonly iterable: Expr.Expr<any>
  readonly body: Block
}

interface ForOfSpec {
  readonly name: string
  readonly iterable: Expr.Expr<any>
  readonly body: (item: Expr.VarRef<any, false>) => Generator<Statement, void, unknown>
}

export class ForOfBuilder<Yields = never> extends PipeableClass() {
  readonly statement: ForOfStatement

  constructor(spec: ForOfSpec) {
    super()
    const item = makePipeable({ tag: "var-ref", name: spec.name }) as Expr.VarRef<any, false>
    this.statement = {
      tag: "for-of",
      name: spec.name,
      iterable: spec.iterable,
      body: materializeVoid(() => spec.body(item)),
    }
  }

  *[Symbol.iterator](): Generator<ForOfStatement | Yields, void, unknown> {
    yield this.statement
  }
}

export function ForOf<
  const Name extends string,
  E,
  const B extends (item: Expr.VarRef<E, false>) => Generator<Statement, void, unknown>,
>(
  name: Name,
  iterable: In<ReadonlyArray<E>>,
  body: B,
): ForOfBuilder<PhantomReturns<B>>
export function ForOf<
  const Name extends string,
  const B extends (item: Expr.VarRef<string, false>) => Generator<Statement, void, unknown>,
>(
  name: Name,
  iterable: In<string>,
  body: B,
): ForOfBuilder<PhantomReturns<B>>
export function ForOf(
  name: string,
  iterable: In<any>,
  body: (item: Expr.VarRef<any, false>) => Generator<Statement, void, unknown>,
): ForOfBuilder<any> {
  return new ForOfBuilder({ name, iterable: norm(iterable), body })
}

export function validateScopes(statements: ReadonlyArray<Statement>): void {
  validateStatements(statements, [new Set<string>()])
}

function declareName(name: string, scopes: Array<Set<string>>, allowShadow: boolean): void {
  const current = scopes[scopes.length - 1]!
  if (current.has(name)) {
    throw new Error(`"${name}" is already declared in this scope`)
  }
  if (!allowShadow && scopes.slice(0, -1).some((scope) => scope.has(name))) {
    throw new Error(`"${name}" shadows an outer binding; pick a fresh name (refs are name-based)`)
  }
  current.add(name)
}

function validateStatements(statements: ReadonlyArray<Statement>, scopes: Array<Set<string>>): void {
  for (const statement of statements) {
    switch (statement.tag) {
      case "let-declaration":
      case "const-declaration": {
        declareName(statement.name, scopes, false)
        break
      }
      case "function-declaration": {
        declareName(statement.name, scopes, false)
        scopes.push(new Set<string>())
        for (const param of statement.params) declareName(param.name, scopes, true)
        if (statement.body) validateStatements(statement.body.statements, scopes)
        scopes.pop()
        break
      }
      case "if": {
        for (const clause of statement.clauses) {
          scopes.push(new Set<string>())
          validateStatements(clause.body.statements, scopes)
          scopes.pop()
        }
        if (statement.else) {
          scopes.push(new Set<string>())
          validateStatements(statement.else.statements, scopes)
          scopes.pop()
        }
        break
      }
      case "while": {
        scopes.push(new Set<string>())
        validateStatements(statement.body.statements, scopes)
        scopes.pop()
        break
      }
      case "for-of": {
        scopes.push(new Set<string>())
        declareName(statement.name, scopes, true)
        validateStatements(statement.body.statements, scopes)
        scopes.pop()
        break
      }
    }
  }
}
