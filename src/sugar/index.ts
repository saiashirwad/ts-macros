// Sugar names nothing new. Each function here lifts its plain arguments to
// nodes with `norm` and calls the core constructor it stands for.

import * as Binding from "../binding.ts"
import * as Expr from "../expr.ts"
import * as Fn from "../function.ts"
import * as Stmt from "../statement.ts"
import type { CheckOperands, ConstType, ElementOf, IsFresh, WidenFresh } from "../types/lattice.ts"
import { type CheckLift, type Denotes, type In, type Norm, norm } from "./norm.ts"

export { type Denotes, type Norm, norm } from "./norm.ts"

// operators

const binary = <const Op extends Expr.BinaryOperator>(op: Op) =>
<const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>, ...CheckOperands<Op, Denotes<L>, Denotes<R>>]
): Expr.Binary<Op, Norm<L>, Norm<R>> => Expr.Binary(op, norm(left as any), norm(right as any), ...[] as never)

const unary = <const Op extends Expr.UnaryOperator>(op: Op) => <const A>(operand: A, ..._check: CheckLift<A>): Expr.Unary<Op, Norm<A>> =>
  Expr.Unary(op, norm(operand as any))

export const add = binary("+")
export const sub = binary("-")
export const mul = binary("*")
export const div = binary("/")
export const mod = binary("%")
export const eq = binary("===")
export const neq = binary("!==")
export const lt = binary("<")
export const lte = binary("<=")
export const gt = binary(">")
export const gte = binary(">=")
export const and = binary("&&")
export const or = binary("||")

export const not = unary("!")
export const typeof_ = unary("typeof")

/** `Fn.Call` with lifted arguments: `call(Expr.Prop(fs, "readFile"), "input.txt")` */
export const call = <P extends unknown[], R>(
  callee: Expr.Expr<(...args: P) => R>,
  ...args: { [K in keyof P]: In<P[K]> }
): Fn.CallExpr<Expr.Expr<any>[], R> => Fn.Call(callee, ...args.map((arg) => norm(arg as any)) as never)

// statements

export const Let = <const X>(name: string, value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<WidenFresh<Norm<X>>, "let"> =>
  Binding.Let(name).pipe(Binding.Init(norm(value, ..._check)))

export const Const = <const X>(
  name: string,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<ConstType<Norm<X>>, "const", IsFresh<Norm<X>>> => Binding.Const(name).pipe(Binding.Init(norm(value, ..._check)))

export const Assign = <const T extends Stmt.LValue, const V extends In<Stmt.WriteType<T>>>(
  target: T,
  value: V,
  ..._check: Parameters<typeof Stmt.Assign<T, Expr.Expr<Stmt.WriteType<T>>>> extends [any, any, ...infer Check] ? Check : never
): Stmt.AssignStatement<T, Expr.Expr<Stmt.WriteType<T>>> => Stmt.Assign(target, norm(value as any) as any, ..._check as never)

type CheckIterable<It> = Denotes<It> extends readonly unknown[] | string ? CheckLift<It> : ["cannot iterate", It]

export const ForOf = <const It, const B extends (item: Expr.VarRef<ElementOf<Denotes<It>>, false>) => Generator<Stmt.Statement, void, unknown>>(
  name: string,
  iterable: It,
  body: B,
  ..._check: CheckIterable<It>
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>> => Stmt.ForOf(name, norm(iterable as any), body as any)
