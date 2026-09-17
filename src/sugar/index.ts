// Sugar names nothing new. Each function here lifts its plain arguments to
// nodes with `norm` and calls the core constructor it stands for.

import * as Binding from "../binding.ts"
import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"
import * as Stmt from "../statement.ts"
import type { ConstWiden, ElementOf, Widen } from "../types/lattice.ts"
import { type Base, type CheckLift, type Denotes, type In, norm, type Surface } from "./norm.ts"
import { expr } from "./surface.ts"

export { type CheckLift, type Denotes, deref, type In, norm, type Surface } from "./norm.ts"
export { expr } from "./surface.ts"

// operators

const binary = <const Op extends Expr.BinaryOperator>(op: Op) =>
<const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<Op, Expr.Expr<Denotes<L>>, Expr.Expr<Denotes<R>>> => Expr.Binary(op, norm(left as any), norm(right as any))

const unary =
  <const Op extends Expr.UnaryOperator>(op: Op) => <const A>(operand: A, ..._check: CheckLift<A>): Expr.Unary<Op, Expr.Expr<Denotes<A>>> =>
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

// statements

export const Let = <const X>(name: string, value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Widen<Denotes<X>>, "let"> =>
  Binding.Let(name).pipe(Binding.Init(norm(value, ..._check)))

export const Const = <const X>(name: string, value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<ConstWiden<Denotes<X>>, "const"> =>
  Binding.Const(name).pipe(Binding.Init(norm(value, ..._check)))

export const Assign = <const T extends Expr.LValue, const V extends In<Expr.Denotes<T>>>(
  target: T,
  value: V,
  ..._check: Expr.IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Expr.Assign<T, Expr.Expr<Expr.Denotes<T>>> => Expr.Assign(target, norm(value as any) as any, ..._check)

/** what a loop iterates: a node's or surface's denotation, or a plain array with its elements denoted */
type Iterated<It> =
    It extends Expr.Expr<infer A> ? A
  : It extends Base<infer A> ? A
  : It extends readonly unknown[] ? { [K in keyof It]: Denotes<It[K]> }
  : It

type LoopBody<It> = (item: Expr.VarRef<ElementOf<Iterated<It>>, false>) => Generator<Stmt.Statement, void, unknown>

export const ForOf = <It extends In<readonly unknown[] | string>, const B extends LoopBody<It>>(
  name: string,
  iterable: It,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>> => Stmt.ForOf(name, norm(iterable as any), body)

// host values, as surfaces

export const import_ = <A = unknown>(source: string, local?: string): Surface<A> => expr(FFI.Import<A>(source, local))

export const ref = <A = unknown>(name: string): Surface<A> => expr(FFI.Value<A>(name))
