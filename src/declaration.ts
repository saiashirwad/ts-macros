import type { Block } from "./block.ts"
import {
  type AnyParams,
  type ArrayExpr,
  type CheckLiftable,
  type CheckParams,
  type ContextualValue,
  type Expr,
  type FnRef,
  type Lift,
  lift,
  type ParamBindings,
  type Ref,
  ref,
} from "./expr.ts"
import { Builder, type Checked, type FailedCheck, freshBindingId, isType, makeStatement, makeType, type Node, type ValueBinding } from "./node.ts"
import type { NonLoopStatement, Phase, ReturnValue, Statement } from "./statement.ts"
import * as Type from "./types/index.ts"
import { bindingType, type ConstType, type IsFresh, isFresh, signatureType, type WidenFresh, type WidenReturn } from "./typing.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly kind: "let-declaration" | "const-declaration"
  readonly expr?: Expr<any> | undefined
  readonly annotation?: Type.Type<any> | undefined
  readonly type?: Type.Type<any> | undefined
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

export class BindingBuilder<A = unknown, Kind extends BindingKind = "let", Fresh extends boolean = false> extends Builder {
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Ref<A, Mutability<Kind>, Fresh>, unknown> {
    const { annotation, expr, id, nameHint, kind, type } = this.declaration
    yield makeStatement(this.declaration)
    const fresh = kind === "const-declaration" && annotation === undefined && expr !== undefined && isFresh(expr)
    return ref(id, nameHint, type, (kind === "let-declaration") as Mutability<Kind>, fresh as Fresh)
  }
}

type CheckInit<Annotation, A> = [A] extends [Annotation] ? [] : ["the initializer", A, "is not assignable to the annotation", Annotation]
type CheckUnannotated<E> = [Lift<E>] extends [ArrayExpr<[]>] ? ["an empty-array initializer needs an annotation"] : []

const declare = (
  kind: BindingDeclaration["kind"],
  nameHint: string,
  expr: Expr<any> | undefined,
  annotation: Type.Type<any> | undefined,
): BindingBuilder<any, any, any> => {
  if (annotation === undefined && expr?.kind === "array" && (expr as ArrayExpr<any>).elements.length === 0) {
    throw new Error("an empty-array initializer needs an annotation")
  }
  return new BindingBuilder({
    kind,
    id: freshBindingId(),
    nameHint,
    expr,
    annotation,
    type: bindingType(kind, annotation, expr),
  })
}

function let_<A>(name: string, annotation: Type.Type<A>): BindingBuilder<A, "let", false>
function let_<const E>(
  name: string,
  init: E,
  ..._check: [...CheckLiftable<E>, ...CheckUnannotated<E>]
): BindingBuilder<WidenFresh<Lift<E>>, "let", false>
function let_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLiftable<E>, ...CheckInit<A, ContextualValue<Lift<E>>>]
): BindingBuilder<A, "let", false>
function let_(name: string, initOrAnnotation: unknown, annotation?: unknown): BindingBuilder<any, "let", false> {
  if (annotation === undefined && isType(initOrAnnotation)) return declare("let-declaration", name, undefined, initOrAnnotation)
  const expr = lift(initOrAnnotation as never)
  const note = annotation as Type.Type<any> | undefined
  return declare("let-declaration", name, expr, note)
}

function const_<const E>(
  name: string,
  init: E,
  ..._check: [...CheckLiftable<E>, ...CheckUnannotated<E>]
): BindingBuilder<ConstType<Lift<E>>, "const", IsFresh<Lift<E>>>
function const_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLiftable<E>, ...CheckInit<A, ContextualValue<Lift<E>>>]
): BindingBuilder<A, "const", false>
function const_(name: string, init: unknown, annotation?: unknown): BindingBuilder<any, "const", any> {
  return declare("const-declaration", name, lift(init as never), annotation as Type.Type<any> | undefined)
}

export type FunctionImpl<Params extends AnyParams> = (
  bindings: ParamBindings<Params>,
) => Generator<NonLoopStatement, unknown, unknown>

interface FunctionHead<Params extends AnyParams, Return, TypeParams extends Type.AnyTypeParams> extends ValueBinding, Node {
  readonly kind: "function-declaration"
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.Type<Return> | undefined
}

export interface PendingFunction<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyTypeParams = Type.AnyTypeParams,
> extends FunctionHead<Params, Return, TypeParams> {
  readonly phase: "pending"
  readonly impl: FunctionImpl<Params>
}

export interface BuiltFunction<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyTypeParams = Type.AnyTypeParams,
> extends FunctionHead<Params, Return, TypeParams> {
  readonly phase: "built"
  readonly body: Block<Statement<"built">>
  readonly type?: Type.Function | undefined
}

interface FunctionPhases<Params extends AnyParams, Return, TypeParams extends Type.AnyTypeParams> {
  readonly pending: PendingFunction<Params, Return, TypeParams>
  readonly built: BuiltFunction<Params, Return, TypeParams>
}

export type FunctionDeclaration<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyTypeParams = Type.AnyTypeParams,
  P extends Phase = Phase,
> = FunctionPhases<Params, Return, TypeParams>[P]

export class FunctionBuilder<Params extends AnyParams = [], Return = unknown, TypeParams extends Type.AnyTypeParams = []> extends Builder {
  readonly declaration: PendingFunction<Params, Return, TypeParams>

  constructor(declaration: PendingFunction<Params, Return, TypeParams>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<PendingFunction<Params, Return, TypeParams>, FnRef<Params, Return, TypeParams>, unknown> {
    yield makeStatement(this.declaration)
    const { id, nameHint, params, returnType, typeParams } = this.declaration
    return ref(id, nameHint, signatureType(params, returnType), false, false, typeParams) as unknown as FnRef<Params, Return, TypeParams>
  }
}

type AcceptsReturn<Value, Declared extends Type.Type<any> | undefined> =
    Declared extends undefined ? true
  : [Value] extends [Type.TypeDenotes<Exclude<Declared, undefined>>] ? true
  : false

type CheckEarlyReturns<Yields, Declared extends Type.Type<any> | undefined> = false extends
  AcceptsReturn<ContextualValue<ReturnValue<Yields>>, Declared>
  ? ["early returns", ContextualValue<ReturnValue<Yields>>, "do not satisfy the declared return type", Type.TypeDenotes<Exclude<Declared, undefined>>]
  : []

export type ImplReturn<Declared extends Type.Type<any> | undefined, Final, Yields> = Declared extends undefined
  ? WidenReturn<Lift<Final> | ReturnValue<Yields>>
  : Type.TypeDenotes<Exclude<Declared, undefined>>

export interface FnSpec<
  Params extends AnyParams = [],
  Declared extends Type.Type<any> | undefined = undefined,
  TypeParams extends Type.AnyTypeParams = [],
  Yields extends NonLoopStatement = NonLoopStatement,
  Final = unknown,
> {
  readonly typeParams?: TypeParams | undefined
  readonly params?: Params | undefined
  readonly returns?: Declared
  readonly body: (bindings: ParamBindings<Params>) => Generator<Yields, Final, unknown>
}

type CheckReturn<Final, Declared extends Type.Type<any> | undefined> = false extends AcceptsReturn<ContextualValue<Lift<Final>>, Declared>
  ? ["the returned value", ContextualValue<Lift<Final>>, "is not assignable to", Type.TypeDenotes<Exclude<Declared, undefined>>]
  : []

type FirstFailedCheck<Checks extends unknown[][], Result> =
    Checks extends [unknown[], ...infer Rest extends unknown[][]] ?
      Checks[0] extends [] ? FirstFailedCheck<Rest, Result>
    : FailedCheck<Checks[0]>
  : Result

export type FnResult<
  Params extends AnyParams,
  Declared extends Type.Type<any> | undefined,
  TypeParams extends Type.AnyTypeParams,
  Yields,
  Final,
  Result = FunctionBuilder<Params, ImplReturn<Declared, Final, Yields>, TypeParams>,
> = FirstFailedCheck<[
  CheckLiftable<Final>,
  CheckParams<Params>,
  Type.CheckTypeParamNames<TypeParams>,
  CheckEarlyReturns<Yields, Declared>,
  CheckReturn<Final, Declared>,
], Result>

export const fn = <
  const Params extends AnyParams = [],
  Declared extends Type.Type<any> | undefined = undefined,
  const TypeParams extends Type.AnyTypeParams = [],
  Yields extends NonLoopStatement = NonLoopStatement,
  const Final = unknown,
>(
  name: string,
  spec:
    & FnSpec<Params, Declared, TypeParams, Yields, Final>
    & Checked<CheckParams<Params>>
    & Checked<Type.CheckTypeParamNames<TypeParams>>,
): FnResult<Params, Declared, TypeParams, Yields, Final> =>
  new FunctionBuilder({
    kind: "function-declaration",
    phase: "pending",
    id: freshBindingId(),
    nameHint: name,
    typeParams: spec.typeParams ?? [],
    params: spec.params ?? [],
    returnType: spec.returns,
    impl: spec.body,
  } as unknown as PendingFunction<Params, ImplReturn<Declared, Final, Yields>, TypeParams>) as FnResult<
    Params,
    Declared,
    TypeParams,
    Yields,
    Final
  >

export interface TypeDeclaration<Body = unknown, Params extends Type.AnyTypeParams = []> extends ValueBinding {
  readonly kind: "type-declaration"
  readonly params: Params
  readonly body: Type.Type<Body>
}

export class TypeBuilder<Body = unknown, Params extends Type.AnyTypeParams = []> extends Builder {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<TypeDeclaration<Body, Params>, Type.TypeRef<Type.Declared<Params, Body>>, unknown> {
    yield makeStatement(this.declaration)
    const { id, nameHint } = this.declaration
    return makeType({ kind: "type-ref", id, nameHint, args: [] })
  }
}

export type ParamContext<Params extends Type.AnyTypeParams> = {
  [P in Params[number] as P["name"]]: P
}

export interface TypeAlias<Body, Params extends Type.AnyTypeParams = []> {
  readonly params: Params
  readonly body: Type.Type<Body>
}

export interface TypeAliasBody<Body, Params extends Type.AnyTypeParams = []> {
  readonly params: Params
  readonly body: (params: ParamContext<Params>) => Type.Type<Body>
}

type CheckedSpec<Params extends Type.AnyTypeParams, Spec> = Spec & Checked<Type.CheckTypeParamNames<Params>>

type AliasSpec = TypeAlias<any, Type.AnyTypeParams> | TypeAliasBody<any, Type.AnyTypeParams>

const aliasBody = (name: string, params: readonly Type.AnyTypeParam[], body: AliasSpec["body"]): Type.Type<any> => {
  if (typeof body !== "function") return body
  const ctx: { [name: string]: Type.AnyTypeParam } = {}
  for (const param of params) ctx[param.name] = param
  const built = body(ctx)
  if (!isType(built)) throw new Error(`type "${name}" body must return a type`)
  return built
}

function type_<Body>(name: string, body: Type.Type<Body>): TypeBuilder<Body, []>
function type_<Body, const Params extends Type.AnyTypeParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAliasBody<Body, Params>>,
): TypeBuilder<Body, Params>
function type_<Body, const Params extends Type.AnyTypeParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAlias<Body, Params>>,
): TypeBuilder<Body, Params>
function type_<Body>(name: string, bodyOrSpec: Type.Type<Body> | AliasSpec): TypeBuilder<Body, Type.AnyTypeParams> {
  if (isType(bodyOrSpec)) return new TypeBuilder({ kind: "type-declaration", id: freshBindingId(), nameHint: name, params: [], body: bodyOrSpec })
  return new TypeBuilder({
    kind: "type-declaration",
    id: freshBindingId(),
    nameHint: name,
    params: bodyOrSpec.params,
    body: aliasBody(name, bodyOrSpec.params, bodyOrSpec.body),
  })
}

export { const_ as const, let_ as let, type_ as type }
