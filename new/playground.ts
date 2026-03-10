import { $, LetBuilder, runMacro, type } from "./core";
import { pipe } from "./pipeable";
import type {
  Expr,
  LetDecl,
  NumberLiteral,
  NumberType,
  Program,
  TypeExpr,
  VarRef,
} from "./core";

const show = <T>(_value: T): void => {};

const preview = $.let("preview").pipe(
  $.init($.number(1)),
  $.annotate(type.number()),
);

const program = runMacro(function* () {
  const x = yield* $.let("x").pipe(
    $.init($.number(1)),
    $.annotate(type.number()),
  );

  const y = yield* $.let("y").pipe($.init(x));

  show<VarRef<number>>(x);
  show<Expr<number>>(x);
  show<VarRef<number>>(y);
  show<VarRef<number>>(x.pipe((value) => value));

  return y;
});

const literal = $.number(1).pipe((value) => value);
const annotation = type.number().pipe((value) => value);
const pipedResult = pipe(program.result, (value) => value);

show<LetBuilder<number>>(preview);
show<Program<VarRef<number>>>(program);
show<ReadonlyArray<LetDecl>>(program.declarations);
show<LetDecl>(program.declarations[0]!);
show<VarRef<number>>(program.result);
show<NumberLiteral>(literal);
show<Expr<number>>(literal);
show<NumberType>(annotation);
show<TypeExpr<number>>(annotation);
show<VarRef<number>>(pipedResult);

// Uncomment to inspect the inferred type through an error:
// show<VarRef<string>>(program.result);
