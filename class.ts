import { $, generate, numeric, str, type, VarRef } from "./src";
import type { TypedExpression } from "./src";

type ScoreBoardLike = {
  bump: () => number;
  describe: () => string;
};

const show = <T>(_value: T): void => {};

const bumpBoard = <T extends ScoreBoardLike>(
  board: VarRef<T> | TypedExpression<T>,
) => $.methodCall(board, "bump");

const describeBoard = <T extends ScoreBoardLike>(
  board: VarRef<T> | TypedExpression<T>,
) => $.methodCall(board, "describe");

const block = $.block(function* () {
  const ScoreBoard = yield* $.class("ScoreBoard", function* () {
    const label = yield* $.classProperty("label", {
      typeAnnotation: type.string(),
      accessibility: "private",
    });
    const score = yield* $.classProperty("score", {
      typeAnnotation: type.number(),
      accessibility: "private",
    });

    yield* $.classMethod(
      "constructor",
      { label: type.string(), score: type.number() },
      function* ({ label: initialLabel, score: initialScore }) {
        yield* $.expression($.assign(label, initialLabel));
        yield* $.expression($.assign(score, initialScore));
      },
      { kind: "constructor" },
    );

    const bump = yield* $.classMethod(
      "bump",
      {},
      function* () {
        yield* $.expression($.assign(score, numeric.add(score, 1)));
        return score;
      },
      { returnType: type.number(), accessibility: "public" },
    );

    const describe = yield* $.classMethod(
      "describe",
      {},
      function* () {
        return $.template`${label}: ${score}`;
      },
      { returnType: type.string(), accessibility: "public" },
    );

    return { bump, describe };
  });

  show<typeof ScoreBoard>(null as any);

  const formatReport = yield* $.function(
    "formatReport",
    [$.p("label", type.string()), $.p("score", type.number())] as const,
    function* ({ label, score }) {
      return $.template`${label} -> ${score}`;
    },
    { returnType: type.string() },
  );

  const { board } = yield* $.bind({
    board: $.new(ScoreBoard, ["tasks", 2]),
  });

  show<VarRef<ScoreBoardLike>>(board);

  const { firstScore, secondScore, summary } = yield* $.bind({
    firstScore: bumpBoard(board),
    secondScore: bumpBoard(board),
    summary: describeBoard(board),
  });

  const { totalWithBonus, excitedSummary, report } = yield* $.bind({
    totalWithBonus: numeric.add(secondScore, 10),
    excitedSummary: str.concat(summary, "!"),
    report: $.call(formatReport, ["tasks total", firstScore]),
  });

  yield* $.function(
    "runProgram",
    [],
    function* () {
      return {
        summary,
        excitedSummary,
        totalWithBonus,
        report,
      };
    },
    {
      returnType: type.object({
        summary: type.string(),
        excitedSummary: type.string(),
        totalWithBonus: type.number(),
        report: type.string(),
      }),
    },
  );
}).toBabelAST();

const { code } = generate(block);
console.log(code);
