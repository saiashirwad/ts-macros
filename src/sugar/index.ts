import * as Binding from "../binding.ts"
import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"
import * as Stmt from "../statement.ts"
import { type Base, type CheckLift, type Denote, type In, norm, type Surface } from "./norm.ts"
import { expr } from "./surface.ts"

export * from "./norm.ts"
export * from "./surface.ts"

const binary = <const Op extends Expr.BinaryOperator>(op: Op) =>
<const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<Op, Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary(op, norm(left as any), norm(right as any))

const unary = <const Op extends Expr.UnaryOperator>(op: Op) => <const A>(operand: A, ..._check: CheckLift<A>): Expr.Unary<Op, Expr.Expr<Denote<A>>> =>
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

export function Let(): Binding.BindingBuilder<unknown, "let">
export function Let<const X>(value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Expr.Widen<Denote<X>>, "let">
export function Let<const Name extends string, const X>(
  name: Name,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<Expr.Widen<Denote<X>>, "let">
export function Let(...args: [] | [In<any>] | [string, In<any>]): Binding.BindingBuilder<any, "let"> {
  if (args.length === 0) return Binding.Let("anon")
  if (args.length === 1) return Binding.Let("anon").pipe(Binding.Init(norm(args[0])))
  return Binding.Let(args[0]).pipe(Binding.Init(norm(args[1])))
}

export function Const<const X>(value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const<const Name extends string, const X>(
  name: Name,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const(...args: [In<any>] | [string, In<any>]): Binding.BindingBuilder<any, "const"> {
  if (args.length === 1) return Binding.Const("anon").pipe(Binding.Init(norm(args[0])))
  if (args[1] === undefined) throw new Error(`const "${args[0]}" requires an initializer`)
  return Binding.Const(args[0]).pipe(Binding.Init(norm(args[1])))
}

export const Assign = <const T extends Expr.LValue, const V extends In<Expr.Denotes<T>>>(
  target: T,
  value: V,
  ..._check: Expr.IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Expr.Assign<T, Expr.Expr<Expr.Denotes<T>>> => Expr.Assign(target, norm(value as any) as any, ..._check)

export const import_ = <A = unknown>(source: string, local?: string): Surface<A> => expr(FFI.Import<A>(source, local))

export const ref = <A = unknown>(name: string): Surface<A> => expr(FFI.Value<A>(name))

/** what a loop iterates: a node's or surface's denotation, or a plain array with its elements denoted */
type Iterated<It> =
    It extends Expr.Expr<infer A> ? A
  : It extends Base<infer A> ? A
  : It extends readonly unknown[] ? { [K in keyof It]: Denote<It[K]> }
  : It

type LoopBody<It> = (item: Expr.VarRef<Stmt.ElementOf<Iterated<It>>, false>) => Generator<Stmt.Statement, void, unknown>

export function forOf<It extends In<readonly unknown[] | string>, const B extends LoopBody<It>>(
  iterable: It,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf<const Name extends string, It extends In<readonly unknown[] | string>, const B extends LoopBody<It>>(
  name: Name,
  iterable: It,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf(...args: [In<any>, any] | [string, In<any>, any]): Stmt.ForOfBuilder<any> {
  if (args.length === 2) return Stmt.ForOf("anon", norm(args[0]) as any, args[1])
  return Stmt.ForOf(args[0], norm(args[1]) as any, args[2])
}
