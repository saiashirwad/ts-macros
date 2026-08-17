import type * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import type * as Fn from "./function.ts"
import { type BindingId, freshBindingId } from "./identity.ts"
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
    if (done) return makePipeable({ tag: "block", statements })
    statements.push(value)
    if (TERMINAL_TAGS.has(value.tag)) return makePipeable({ tag: "block", statements })
  }
}

export function materializeValue<A extends Expr.Expr<any>>(body: Body<A>): Block {
  const statements: Statement[] = []
  const iterator = body()
  while (true) {
    const { value, done } = iterator.next()
    if (done) {
      statements.push(Return(value))
      return makePipeable({ tag: "block", statements })
    }
    statements.push(value)
    if (TERMINAL_TAGS.has(value.tag)) return makePipeable({ tag: "block", statements })
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
    yield makeYieldable({
      tag: "if" as const,
      clauses: this.spec.clauses.map(({ condition, body }) => ({
        condition,
        body: materializeVoid(body),
      })),
      else: this.spec.elseBody === null ? null : materializeVoid(this.spec.elseBody),
    })
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

export const While = <const C extends Expr.Expr<boolean>, const B extends Body<void>>(
  condition: C,
  body: B,
): WhileBuilder<PhantomReturns<B>> => new WhileBuilder(makeYieldable({ tag: "while" as const, condition, body: materializeVoid(body) }))

/** the element type a for-of loop variable should denote */
export type ElementOf<A> =
    A extends ReadonlyArray<infer E> ? E
  : A extends string ? string
  : never

export interface ForOfStatement {
  readonly tag: "for-of"
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr.Expr<any>
  readonly body: Block
}

interface ForOfSpec {
  readonly id: BindingId
  readonly nameHint: string
  readonly iterable: Expr.Expr<any>
  readonly body: (item: Expr.VarRef<any, false>) => Generator<Statement, void, unknown>
}

export class ForOfBuilder<Yields = never> extends PipeableClass() {
  readonly statement: ForOfStatement

  constructor(spec: ForOfSpec) {
    super()
    const item = Expr.LocalRef<any, false>(spec.id, spec.nameHint)
    this.statement = makeYieldable({
      tag: "for-of" as const,
      id: spec.id,
      nameHint: spec.nameHint,
      iterable: spec.iterable,
      body: materializeVoid(() => spec.body(item)),
    })
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
): ForOfBuilder<PhantomReturns<B>> => new ForOfBuilder({ id: freshBindingId(), nameHint, iterable, body })

interface NamedBinding {
  readonly id: BindingId
  readonly nameHint: string
}

interface ScopeValidation {
  readonly declarations: Map<BindingId, string>
}

export function validateScopes(statements: ReadonlyArray<Statement>): void {
  validateStatements(statements, [], { declarations: new Map() })
}

const registerBinding = (
  binding: NamedBinding,
  ids: Set<BindingId>,
  names: Set<string>,
  state: ScopeValidation,
): void => {
  if (ids.has(binding.id) || state.declarations.has(binding.id)) {
    throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
  }
  if (names.has(binding.nameHint)) {
    throw new Error(`"${binding.nameHint}" is already declared in this scope`)
  }
  ids.add(binding.id)
  names.add(binding.nameHint)
  state.declarations.set(binding.id, binding.nameHint)
}

const validateReference = (
  reference: { readonly target: BindingId; readonly nameHint: string },
  scopes: ReadonlyArray<ReadonlySet<BindingId>>,
): void => {
  if (!scopes.some((scope) => scope.has(reference.target))) {
    throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding`)
  }
}

const validateExpression = (
  expression: Expr.Expr<any>,
  scopes: ReadonlyArray<ReadonlySet<BindingId>>,
  state: ScopeValidation,
): void => {
  const node = expression as Expr.Any | Fn.Any
  switch (node.tag) {
    case "literal":
    case "external-ref":
      return
    case "var-ref":
    case "function-ref":
    case "generic-function-ref":
      validateReference(node, scopes)
      return
    case "prop":
      validateExpression(node.object, scopes, state)
      return
    case "index":
      validateExpression(node.object, scopes, state)
      validateExpression(node.index, scopes, state)
      return
    case "array":
      node.elements.forEach((element: Expr.Expr<any>) => validateExpression(element, scopes, state))
      return
    case "object":
      Object.values(node.fields).forEach((field) => validateExpression(field, scopes, state))
      return
    case "call-expr":
      validateExpression(node.callee, scopes, state)
      node.args.forEach((argument) => validateExpression(argument, scopes, state))
      return
    case "instantiation":
      validateExpression(node.callee, scopes, state)
      return
    case "arrow":
      validateStatements(node.body.statements, scopes, state, node.params)
      return
    case "binary":
      validateExpression(node.left, scopes, state)
      validateExpression(node.right, scopes, state)
      return
    case "unary":
      validateExpression(node.operand, scopes, state)
      return
    case "template":
      node.exprs.forEach((part) => validateExpression(part, scopes, state))
      return
    case "cond":
      validateExpression(node.condition, scopes, state)
      validateExpression(node.then, scopes, state)
      validateExpression(node.else, scopes, state)
      return
    case "assign":
      validateExpression(node.target, scopes, state)
      validateExpression(node.value, scopes, state)
      return
  }
}

function validateStatements(
  statements: ReadonlyArray<Statement>,
  outerScopes: ReadonlyArray<ReadonlySet<BindingId>>,
  state: ScopeValidation,
  initial: ReadonlyArray<NamedBinding> = [],
): void {
  const ids = new Set<BindingId>()
  const names = new Set<string>()
  for (const binding of initial) registerBinding(binding, ids, names, state)
  for (const statement of statements) {
    if (statement.tag === "let-declaration" || statement.tag === "const-declaration" || statement.tag === "function-declaration") {
      registerBinding(statement, ids, names, state)
    }
  }
  const scopes = [...outerScopes, ids]

  for (const statement of statements) {
    switch (statement.tag) {
      case "let-declaration":
      case "const-declaration":
        if (statement.expr !== undefined) validateExpression(statement.expr, scopes, state)
        break
      case "function-declaration":
        if (statement.body !== undefined) validateStatements(statement.body.statements, scopes, state, statement.params)
        break
      case "type-declaration":
      case "break":
      case "continue":
        break
      case "return":
      case "throw":
        validateExpression(statement.value, scopes, state)
        break
      case "expr-statement":
        validateExpression(statement.expr, scopes, state)
        break
      case "assign":
        validateExpression(statement, scopes, state)
        break
      case "if":
        for (const clause of statement.clauses) {
          validateExpression(clause.condition, scopes, state)
          validateStatements(clause.body.statements, scopes, state)
        }
        if (statement.else !== null) validateStatements(statement.else.statements, scopes, state)
        break
      case "while":
        validateExpression(statement.condition, scopes, state)
        validateStatements(statement.body.statements, scopes, state)
        break
      case "for-of":
        validateExpression(statement.iterable, scopes, state)
        validateStatements(statement.body.statements, scopes, state, [statement])
        break
    }
  }
}

// Rebuild a statement with every directly nested block of child statements mapped.
// Passes own their block logic (folding state, inserting, dropping), while this
// encapsulates which statement shapes contain child statement blocks.
export const mapChildStatements = (
  statement: Statement,
  map: (statements: ReadonlyArray<Statement>) => Statement[],
): Statement => {
  switch (statement.tag) {
    case "if":
      return makeYieldable({
        ...statement,
        clauses: statement.clauses.map((clause) => ({ ...clause, body: { tag: "block", statements: map(clause.body.statements) } })),
        else: statement.else === null ? null : { tag: "block", statements: map(statement.else.statements) },
      })
    case "while":
    case "for-of":
      return makeYieldable({ ...statement, body: { tag: "block", statements: map(statement.body.statements) } })
    case "function-declaration":
      return statement.body === undefined
        ? statement
        : makeYieldable({ ...statement, body: { tag: "block", statements: map(statement.body.statements) } })
    default:
      return statement
  }
}
