import type * as Binding from "./binding.ts"
import type * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import { type CheckLift, type Denote, type In, norm } from "./norm.ts"
import { makePipeable, makeYieldable, type Pipeable, PipeableClass, type Yieldable } from "./pipeable.ts"
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
  | WhileStatement<any>
  | ForOfStatement<any>
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

const collect = (
  iterator: Generator<Statement, In<any> | void, unknown>,
): { statements: Statement[]; result: In<any> | void; terminated: boolean } => {
  const statements: Statement[] = []
  while (true) {
    const { value, done } = iterator.next()
    if (done) return { statements, result: value, terminated: false }
    statements.push(value)
    if (TERMINAL_TAGS.has(value.tag)) return { statements, result: undefined, terminated: true }
  }
}

export function materializeVoid(body: Body<void>): Block {
  return { tag: "block", statements: collect(body()).statements }
}

export function materializeValue(body: () => Generator<Statement, In<any> | void, unknown>): Block {
  const { statements, result, terminated } = collect(body())
  if (!terminated && result !== undefined) statements.push(Return(result))
  return { tag: "block", statements }
}

export type ReturnValue<Y> = Y extends ReturnStatement<infer A> ? A : never

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

// Yields is phantom: the node only ever yields itself, but early returns in
// the body ride the declared union so callers see them
export interface WhileStatement<Yields = never> extends Pipeable {
  readonly tag: "while"
  readonly condition: Expr.Expr<any>
  readonly body: Block
  [Symbol.iterator](): Generator<WhileStatement<any> | Yields, void, unknown>
}

export const While = <const B extends Body<void>>(
  condition: In<boolean>,
  body: B,
): WhileStatement<PhantomReturns<B>> =>
  makeYieldable({ tag: "while", condition: norm(condition), body: materializeVoid(body) }) as WhileStatement<PhantomReturns<B>>

export interface ForOfStatement<Yields = never> extends Pipeable {
  readonly tag: "for-of"
  readonly name: string
  readonly iterable: Expr.Expr<any>
  readonly body: Block
  [Symbol.iterator](): Generator<ForOfStatement<any> | Yields, void, unknown>
}

export function ForOf<
  const Name extends string,
  E,
  const B extends (item: Expr.VarRef<E, false>) => Generator<Statement, void, unknown>,
>(
  name: Name,
  iterable: In<ReadonlyArray<E>>,
  body: B,
): ForOfStatement<PhantomReturns<B>>
export function ForOf<
  const Name extends string,
  const B extends (item: Expr.VarRef<string, false>) => Generator<Statement, void, unknown>,
>(
  name: Name,
  iterable: In<string>,
  body: B,
): ForOfStatement<PhantomReturns<B>>
export function ForOf(
  name: string,
  iterable: In<any>,
  body: (item: Expr.VarRef<any, false>) => Generator<Statement, void, unknown>,
): ForOfStatement<any> {
  const item = makePipeable({ tag: "var-ref", name }) as Expr.VarRef<any, false>
  return makeYieldable({
    tag: "for-of",
    name,
    iterable: norm(iterable),
    body: materializeVoid(() => body(item)),
  }) as ForOfStatement<any>
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
      case "binding": {
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
