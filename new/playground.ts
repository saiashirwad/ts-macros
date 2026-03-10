import * as $ from "./$";
import * as type from "./type";
import type { Declaration } from "./foundation/declaration";
import type { Expr } from "./foundation/expr";
import type { Program } from "./foundation/program";
import type { TypeExpr } from "./foundation/type-expr";
import type { FunctionBuilder } from "./declarations/function";
import type { LetBuilder } from "./declarations/let";
import type { TypeBuilder } from "./declarations/type";
import type { Param } from "./functions/params";
import { pipe } from "./pipeable";
import type { NumberLiteral, NumberType } from "./primitives/number";
import type { FunctionRef } from "./refs/function-ref";
import type { TypeRef } from "./refs/type-ref";
import type { VarRef } from "./refs/var-ref";
import { runMacro } from "./runtime/run-macro";
import type { ObjectType } from "./type-level/object";
import type { TypeApplication } from "./type-level/apply";
import type { DeclaredType, TypeParam, TypeVariable } from "./type-level/param";

const show = <T>(_value: T): void => {};

const preview = $.let("preview").pipe($.init($.number(1)), $.annotate(type.number()));

const previewFunction = $.function("previewFunction").pipe(
  $.params($.p("value", type.number())),
  $.returns(type.number()),
  $.impl(function* ({ value }) {
    return value;
  }),
);

const previewType = $.type("Preview").pipe($.body(type.number()));
const T = type.param("T");
const previewGenericType = $.type("PreviewBox").pipe(
  $.typeParams(T),
  $.body(type.object({ value: T })),
);

const program = runMacro(function* () {
  const Age = yield* $.type("Age").pipe($.body(type.number()));
  const BoxT = type.param("T");
  const Box = yield* $.type("Box").pipe(
    $.typeParams(BoxT),
    $.body(type.object({ value: BoxT })),
  );

  const identity = yield* $.function("identity").pipe(
    $.params($.p("value", type.number())),
    $.returns(type.number()),
    $.impl(function* ({ value }) {
      const echoed = yield* $.let("echoed").pipe($.init(value));

      show<VarRef<number>>(value);
      show<VarRef<number>>(echoed);

      return echoed;
    }),
  );

  const x = yield* $.let("x").pipe($.init($.number(1)), $.annotate(Age));

  const boxedType = type.apply(Box, type.number());

  const boxed = yield* $.let("boxed").pipe(
    $.init($.number(2)),
    $.annotate(boxedType),
  );

  const y = yield* $.let("y").pipe($.init($.call(identity, [x])), $.annotate(boxedType));

  show<VarRef<number>>(x);
  show<VarRef<{ readonly value: number }>>(boxed);
  show<Expr<number>>(x);
  show<VarRef<{ readonly value: number }>>(y);
  show<VarRef<number>>(x.pipe(value => value));
  show<TypeRef<number>>(Age);
  show<TypeExpr<number>>(Age);
  show<TypeRef<DeclaredType<readonly [TypeParam<"T">], { readonly value: TypeVariable<"T"> }>>>(Box);
  show<TypeApplication<{ readonly value: number }>>(boxedType);
  show<TypeExpr<{ readonly value: number }>>(boxedType);
  show<FunctionRef<readonly [Param<"value", number>], number>>(identity);
  show<Expr<(...args: readonly [Expr<number>]) => number>>(identity);

  return y;
});

const literal = $.number(1).pipe(value => value);
const annotation = type.number().pipe(value => value);
const pipedResult = pipe(program.result, value => value);

show<LetBuilder<number>>(preview);
show<FunctionBuilder<readonly [Param<"value", number>], number>>(previewFunction);
show<TypeBuilder<number>>(previewType);
show<TypeParam<"T">>(T);
show<TypeExpr<TypeVariable<"T">>>(T);
show<ObjectType<{ readonly value: TypeParam<"T"> }>>(type.object({ value: T }));
show<TypeBuilder<{ readonly value: TypeVariable<"T"> }, readonly [TypeParam<"T">]>>(previewGenericType);
show<Program<VarRef<number>>>(program);
show<ReadonlyArray<Declaration>>(program.declarations);
show<Declaration>(program.declarations[0]!);
show<VarRef<number>>(program.result);
show<NumberLiteral>(literal);
show<Expr<number>>(literal);
show<NumberType>(annotation);
show<TypeExpr<number>>(annotation);
show<VarRef<number>>(pipedResult);

// Uncomment to inspect the inferred type through an error:
// show<VarRef<string>>(program.result);
