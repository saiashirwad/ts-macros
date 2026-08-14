import * as Binding from "../binding.ts"
import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"
import * as Fn from "../function.ts"
import { type CheckLift, type Denote, type In, norm, type Surface } from "../norm.ts"
import * as Stmt from "../statement.ts"
import { callsiteName, callsiteParamName } from "./callsite.ts"
import { callableRef, expr } from "./surface.ts"

export * from "../norm.ts"
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
  if (args.length === 0) return Binding.Let(callsiteName(Let))
  if (args.length === 1) return Binding.Let(callsiteName(Let)).pipe(Binding.Init(args[0]))
  return Binding.Let(args[0]).pipe(Binding.Init(args[1]))
}

export function Const<const X>(value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const<const Name extends string, const X>(
  name: Name,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const(...args: [In<any>] | [string, In<any>]): Binding.BindingBuilder<any, "const"> {
  if (args.length === 1) return Binding.Const(callsiteName(Const)).pipe(Binding.Init(args[0]))
  if (args[1] === undefined) throw new Error(`const "${args[0]}" requires an initializer`)
  return Binding.Const(args[0]).pipe(Binding.Init(args[1]))
}

export const Assign = <const T extends Expr.LValue, const V extends In<Expr.Denotes<T>>>(
  target: T,
  value: V,
  ..._check: Expr.IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Expr.Assign<T, Expr.Expr<Expr.Denotes<T>>> => Expr.Assign(target, norm(value as any), ..._check)

export function fun<const P extends Fn.AnyParams, Yields extends Stmt.Statement, const TR>(
  params: [...P],
  impl: (bindings: Fn.ParamBindings<P>) => Generator<Yields, TR, unknown>,
): Fn.FunctionBuilder<P, Denote<TR> | Stmt.ReturnValue<Yields>, []>
export function fun<const Name extends string, const P extends Fn.AnyParams, Yields extends Stmt.Statement, const TR>(
  name: Name,
  params: [...P],
  impl: (bindings: Fn.ParamBindings<P>) => Generator<Yields, TR, unknown>,
): Fn.FunctionBuilder<P, Denote<TR> | Stmt.ReturnValue<Yields>, []>
export function fun(...args: [Fn.AnyParams, any] | [string, Fn.AnyParams, any]): Fn.FunctionBuilder<any, any, any> {
  const [name, params, impl] = (typeof args[0] === "string" ? args : [callsiteName(fun), ...args]) as [string, Fn.AnyParams, any]
  return Function(name).pipe(Fn.Params(...params), Fn.Impl(impl))
}

// the sugar Function: same builder, but the yield* ref is a callable surface
export const Function = (name: string): Fn.FunctionBuilder =>
  new Fn.FunctionBuilder({ tag: "function-declaration", name, typeParams: [], params: [], ref: callableRef })

export const import_ = <A = unknown>(source: string, local?: string): Surface<A> => expr(FFI.Import<A>(source, local))

export const ref = <A = unknown>(name: string): Surface<A> => expr(FFI.Value<A>(name))

export function forOf<E, const B extends (item: Expr.VarRef<E, false>) => Generator<Stmt.Statement, void, unknown>>(
  iterable: In<readonly E[]>,
  body: B,
): Stmt.ForOfStatement<Stmt.PhantomReturns<B>>
export function forOf<const B extends (item: Expr.VarRef<string, false>) => Generator<Stmt.Statement, void, unknown>>(
  iterable: In<string>,
  body: B,
): Stmt.ForOfStatement<Stmt.PhantomReturns<B>>
export function forOf<const Name extends string, E, const B extends (item: Expr.VarRef<E, false>) => Generator<Stmt.Statement, void, unknown>>(
  name: Name,
  iterable: In<readonly E[]>,
  body: B,
): Stmt.ForOfStatement<Stmt.PhantomReturns<B>>
export function forOf<const Name extends string, const B extends (item: Expr.VarRef<string, false>) => Generator<Stmt.Statement, void, unknown>>(
  name: Name,
  iterable: In<string>,
  body: B,
): Stmt.ForOfStatement<Stmt.PhantomReturns<B>>
export function forOf(...args: [In<any>, any] | [string, In<any>, any]): Stmt.ForOfStatement<any> {
  if (args.length === 2) return Stmt.ForOf(callsiteParamName(forOf), args[0], args[1])
  return Stmt.ForOf(args[0], args[1], args[2])
}
