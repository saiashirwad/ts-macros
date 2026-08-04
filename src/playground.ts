import * as $ from "./$.ts"
import type { FunctionBuilder, FunctionTypeApplicationExpr } from "./declarations/function.ts"
import type { LetBuilder } from "./declarations/let.ts"
import type { TypeBuilder } from "./declarations/type.ts"
import type { ObjectExpr } from "./expressions/object.ts"
import type { Declaration } from "./foundation/declaration.ts"
import type { Expr } from "./foundation/expr.ts"
import type { Program } from "./foundation/program.ts"
import type { TypeExpr } from "./foundation/type-expr.ts"
import type { Param } from "./functions/params.ts"
import { pipe } from "./pipeable.ts"
import type { NumberLiteral, NumberType } from "./primitives/number.ts"
import type { StringLiteral, StringType } from "./primitives/string.ts"
import type { DeclaredFunction, FunctionLambda, FunctionRef } from "./refs/function-ref.ts"
import type { TypeRef } from "./refs/type-ref.ts"
import type { VarRef } from "./refs/var-ref.ts"
import { runMacro } from "./runtime/run-macro.ts"
import type { TypeApplication } from "./type-level/apply.ts"
import type { LiteralType } from "./type-level/literal.ts"
import type { ObjectType } from "./type-level/object.ts"
import type { DeclaredType, TypeParam, TypeVariable } from "./type-level/param.ts"
import type { UnionType } from "./type-level/union.ts"
import * as type from "./type.ts"

const show = <T>(_value: T): void => {}

type BoxValue<T> = { readonly value: T }
type ResultValue<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E }

const T = type.param("T")
const E = type.param("E")

const preview = $.let("preview").pipe($.init($.number(1)), $.annotate(type.number()))

const previewFunction = $.function("previewFunction").pipe(
  $.params($.p("value", type.number())),
  $.returns(type.number()),
  $.impl(function* ({ value }) {
    return value
  }),
)
const previewGenericFunction = $.function("previewGenericFunction").pipe(
  $.typeParams(T),
  $.params($.p("value", T)),
  $.returns(T),
  $.impl(function* ({ value }) {
    return value
  }),
)
const previewGenericFunctionInferred = $.function("previewGenericFunctionInferred").pipe(
  $.typeParams(T),
  $.params($.p("value", T)),
  $.impl(function* ({ value }) {
    return value
  }),
)
const previewExplicitFunction = $.function("previewExplicitFunction").pipe(
  $.params($.p("value", type.number())),
  $.returns(type.number()),
  $.impl(function* ({ value }) {
    return value
  }),
)
const previewMismatchedFunction = $.function("previewMismatchedFunction").pipe(
  $.params($.p("value", type.number())),
  $.returns(type.string()),
  // @ts-expect-error explicit return must agree with the implementation
  $.impl(function* ({ value }) {
    return value
  }),
)

const previewType = $.type("Preview").pipe($.body(type.number()))
const previewGenericType = $.type("PreviewBox").pipe(
  $.typeParams(T),
  $.body(type.object({ value: T })),
)
const previewResultType = $.type("PreviewResult").pipe(
  $.typeParams(T, E),
  $.body(
    type.union(
      type.object({ _tag: type.literal("Ok"), value: T }),
      type.object({ _tag: type.literal("Err"), error: E }),
    ),
  ),
)

const program = runMacro(function* () {
  const Age = yield* $.type("Age").pipe($.body(type.number()))
  const BoxT = type.param("T")
  const ResultT = type.param("T")
  const ResultE = type.param("E")
  const IdentityT = type.param("T")
  const Box = yield* $.type("Box").pipe($.typeParams(BoxT), $.body(type.object({ value: BoxT })))
  const Result = yield* $.type("Result").pipe(
    $.typeParams(ResultT, ResultE),
    $.body(
      type.union(
        type.object({ _tag: type.literal("Ok"), value: ResultT }),
        type.object({ _tag: type.literal("Err"), error: ResultE }),
      ),
    ),
  )

  const identity = yield* $.function("identity").pipe(
    $.params($.p("value", type.number())),
    $.returns(type.number()),
    $.impl(function* ({ value }) {
      const echoed = yield* $.let("echoed").pipe($.init(value))

      return echoed
    }),
  )
  const genericIdentity = yield* $.function("genericIdentity").pipe(
    $.typeParams(IdentityT),
    $.params($.p("value", IdentityT)),
    $.impl(function* ({ value }) {
      show<VarRef<TypeVariable<"T">>>(value)

      return value
    }),
  )

  const x = yield* $.let("x").pipe($.init($.number(1)), $.annotate(Age))
  const label = yield* $.let("label").pipe($.init($.string("hello")), $.annotate(type.string()))

  const boxedType = type.apply(Box, type.number())
  const numberResultType = type.apply(Result, type.number(), type.string())

  const boxed = yield* $.let("boxed").pipe(
    $.init($.object({ value: $.number(2) })),
    $.annotate(boxedType),
  )

  const numberIdentity = $.instantiate(genericIdentity, type.number())
  const y = yield* $.let("y").pipe($.init($.call(identity, [x])), $.annotate(boxedType))
  const z = yield* $.let("z").pipe($.init($.call(numberIdentity, [x])), $.annotate(type.number()))
  const result = yield* $.let("result").pipe(
    $.init(
      $.object({
        _tag: $.string("Ok"),
        value: z,
      }),
    ),
    $.annotate(numberResultType),
  )

  show<VarRef<number>>(x)
  show<VarRef<string>>(label)
  show<VarRef<BoxValue<number>>>(boxed)
  show<Expr<number>>(x)
  show<VarRef<BoxValue<number>>>(y)
  show<VarRef<number>>(z)
  show<VarRef<ResultValue<number, string>>>(result)
  show<VarRef<number>>(x.pipe((value) => value))
  show<TypeRef<number>>(Age)
  show<TypeExpr<number>>(Age)
  show<TypeRef<DeclaredType<readonly [TypeParam<"T">], BoxValue<TypeVariable<"T">>>>>(Box)
  show<
    TypeRef<
      DeclaredType<
        readonly [TypeParam<"T">, TypeParam<"E">],
        ResultValue<TypeVariable<"T">, TypeVariable<"E">>
      >
    >
  >(Result)
  show<TypeApplication<{ readonly value: number }>>(boxedType)
  show<TypeExpr<{ readonly value: number }>>(boxedType)
  show<TypeApplication<ResultValue<number, string>>>(numberResultType)
  show<TypeExpr<ResultValue<number, string>>>(numberResultType)
  show<FunctionRef<readonly [Param<"value", number>], number>>(identity)
  show<Expr<(...args: readonly [Expr<number>]) => number>>(identity)
  show<
    FunctionRef<
      readonly [Param<"value", TypeVariable<"T">>],
      TypeVariable<"T">,
      readonly [TypeParam<"T">]
    >
  >(genericIdentity)
  show<
    Expr<
      DeclaredFunction<
        readonly [TypeParam<"T">],
        readonly [Param<"value", TypeVariable<"T">>],
        TypeVariable<"T">
      >
    >
  >(genericIdentity)
  show<
    Expr<
      FunctionLambda<
        readonly [TypeParam<"T">],
        readonly [Param<"value", TypeVariable<"T">>],
        TypeVariable<"T">
      >
    >
  >(genericIdentity)
  show<
    FunctionTypeApplicationExpr<
      readonly [Param<"value", TypeVariable<"T">>],
      TypeVariable<"T">,
      readonly [TypeParam<"T">],
      readonly [NumberType]
    >
  >(numberIdentity)
  show<Expr<(...args: readonly [Expr<number>]) => number>>(numberIdentity)

  return result
})

const literal = $.number(1).pipe((value) => value)
const greeting = $.string("hi").pipe((value) => value)
const objectLiteral = $.object({
  _tag: $.string("Ok"),
  value: $.number(1),
}).pipe((value) => value)
const annotation = type.number().pipe((value) => value)
const stringAnnotation = type.string().pipe((value) => value)
const tagAnnotation = type.literal("Ok").pipe((value) => value)
const previewUnion = type.union(
  type.object({ _tag: type.literal("Ok"), value: type.number() }),
  type.object({ _tag: type.literal("Err"), error: type.string() }),
)
const pipedResult = pipe(program.result, (value) => value)

show<LetBuilder<number>>(preview)
show<FunctionBuilder<readonly [Param<"value", number>], number>>(previewFunction)
show<
  FunctionBuilder<
    readonly [Param<"value", TypeVariable<"T">>],
    TypeVariable<"T">,
    readonly [TypeParam<"T">]
  >
>(previewGenericFunction)
show<
  FunctionBuilder<
    readonly [Param<"value", TypeVariable<"T">>],
    TypeVariable<"T">,
    readonly [TypeParam<"T">]
  >
>(previewGenericFunctionInferred)
show<FunctionBuilder<readonly [Param<"value", number>], number>>(previewExplicitFunction)
show<TypeBuilder<number>>(previewType)
show<TypeParam<"T">>(T)
show<TypeParam<"E">>(E)
show<TypeExpr<TypeVariable<"T">>>(T)
show<ObjectType<{ readonly value: TypeParam<"T"> }>>(type.object({ value: T }))
show<TypeBuilder<BoxValue<TypeVariable<"T">>, readonly [TypeParam<"T">]>>(previewGenericType)
show<
  TypeBuilder<
    ResultValue<TypeVariable<"T">, TypeVariable<"E">>,
    readonly [TypeParam<"T">, TypeParam<"E">]
  >
>(previewResultType)
show<Program<VarRef<ResultValue<number, string>>>>(program)
show<ReadonlyArray<Declaration>>(program.declarations)
show<Declaration>(program.declarations[0]!)
show<VarRef<ResultValue<number, string>>>(program.result)
show<NumberLiteral>(literal)
show<Expr<number>>(literal)
show<StringLiteral>(greeting)
show<Expr<string>>(greeting)
show<ObjectExpr<{ readonly _tag: StringLiteral; readonly value: NumberLiteral }>>(objectLiteral)
show<Expr<{ readonly _tag: string; readonly value: number }>>(objectLiteral)
show<NumberType>(annotation)
show<TypeExpr<number>>(annotation)
show<StringType>(stringAnnotation)
show<TypeExpr<string>>(stringAnnotation)
show<LiteralType<"Ok">>(tagAnnotation)
show<TypeExpr<"Ok">>(tagAnnotation)
show<
  UnionType<
    readonly [
      ObjectType<{
        readonly _tag: LiteralType<"Ok">
        readonly value: NumberType
      }>,
      ObjectType<{
        readonly _tag: LiteralType<"Err">
        readonly error: StringType
      }>,
    ]
  >
>(previewUnion)
show<TypeExpr<ResultValue<number, string>>>(previewUnion)
show<VarRef<ResultValue<number, string>>>(pipedResult)
show(previewMismatchedFunction)

// Uncomment to inspect the inferred type through an error:
// show<VarRef<string>>(program.result);
