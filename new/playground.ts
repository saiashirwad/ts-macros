import * as $ from "./$";
import * as type from "./type";
import type { Declaration } from "./foundation/declaration";
import type { Expr } from "./foundation/expr";
import type { Program } from "./foundation/program";
import type { TypeExpr } from "./foundation/type-expr";
import type { FunctionBuilder } from "./declarations/function";
import type { LetBuilder } from "./declarations/let";
import type { Param } from "./functions/params";
import { pipe } from "./pipeable";
import type { NumberLiteral, NumberType } from "./primitives/number";
import type { FunctionRef } from "./refs/function-ref";
import type { VarRef } from "./refs/var-ref";
import { runMacro } from "./runtime/run-macro";

const show = <T>(_value: T): void => {};

const preview = $.let("preview").pipe(
  $.init($.number(1)),
  $.annotate(type.number()),
);

const previewFunction = $.function("previewFunction").pipe(
  $.params($.p("value", type.number())),
  $.returns(type.number()),
  $.impl(function* ({ value }) {
    return value;
  }),
);

const program = runMacro(function* () {
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

  const x = yield* $.let("x").pipe(
    $.init($.number(1)),
    $.annotate(type.number()),
  );

  const y = yield* $.let("y").pipe(
    $.init($.call(identity, [x])),
    $.annotate(type.number()),
  );

  show<VarRef<number>>(x);
  show<Expr<number>>(x);
  show<VarRef<number>>(y);
  show<VarRef<number>>(x.pipe((value) => value));
  show<FunctionRef<readonly [Param<"value", number>], number>>(identity);
  show<Expr<(...args: readonly [Expr<number>]) => number>>(identity);

  return y;
});

const literal = $.number(1).pipe((value) => value);
const annotation = type.number().pipe((value) => value);
const pipedResult = pipe(program.result, (value) => value);

show<LetBuilder<number>>(preview);
show<FunctionBuilder<readonly [Param<"value", number>], number>>(previewFunction);
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
