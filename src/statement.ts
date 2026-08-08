import type * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import type * as Let from "./let.ts"
import { makePipeable, makeYieldable, PipeableClass, type Yieldable } from "./pipeable.ts"
import type * as Type from "./type.ts"

export type Statement =
  | Let.LetDeclaration
  | Let.ConstDeclaration
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

export function materializeValue<A extends Expr.Expr<any>>(body: Body<A>): Block {
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

export type PhantomReturns<B> = [BodyReturns<B>] extends [never] ? never : ReturnStatement<BodyReturns<B>>

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
}

export const If = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(
  condition: C,
  body: B,
): IfBuilder<PhantomReturns<B>> => new IfBuilder({ clauses: [{ condition, body }], elseBody: null })

export const ElseIf = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(
  condition: C,
  body: B,
) =>
<Y>({ spec: { clauses, ...spec } }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, false> =>
  new IfBuilder({ ...spec, clauses: [...clauses, { condition, body }] })

export const Else =
  <const B extends Body<void>>(elseBody: B) =>
  <Y>({ spec }: IfBuilder<Y, false>): IfBuilder<Y | PhantomReturns<B>, true> => new IfBuilder({ ...spec, elseBody })

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

export const While = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(
  condition: C,
  body: B,
): WhileBuilder<PhantomReturns<B>> => new WhileBuilder({ tag: "while", condition, body: materializeVoid(body) })

/** the element type a for-of loop variable should denote */
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

export const ForOf = <
  const Name extends string,
  const It extends Expr.Expr<ReadonlyArray<unknown> | string>,
  const B extends (item: Expr.VarRef<ElementOf<Expr.Denotes<It>>, false>) => Generator<Statement, void, unknown>,
>(
  name: Name,
  iterable: It,
  body: B,
): ForOfBuilder<PhantomReturns<B>> => new ForOfBuilder({ name, iterable, body })

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
