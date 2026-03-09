import type { TypedExpression } from "./src";
import { $, generate, numeric, type, VarRef } from "./src";

type ScoreBoardLike = {
  bump: () => number;
  describe: () => string;
};

const bumpBoard = <T extends ScoreBoardLike>(board: VarRef<T> | TypedExpression<T>) =>
  $.methodCall(board, "bump");

const describeBoard = <T extends ScoreBoardLike>(board: VarRef<T> | TypedExpression<T>) =>
  $.methodCall(board, "describe");

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

    yield* $.constructor(
      [$.p("label", type.string()), $.p("score", type.number())] as const,
      function* ({ label: initialLabel, score: initialScore }) {
        yield* $.expression($.assign(label, initialLabel));
        yield* $.expression($.assign(score, initialScore));
      },
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

  const { board, board2Incorrect } = yield* $.bind({
    board: $.new(ScoreBoard, ["tasks", 2]),
    // @ts-expect-error this should be oopsie
    board2Incorrect: $.new(ScoreBoard, [2, "tasks"]),
  });

  const a = yield* $.let("a", $.methodCall(board, "describe", []));
  //    ^?

  // @ts-expect-error this should be another oopsie
  $.new(ScoreBoard, []);
}).toBabelAST();

const { code } = generate(block);
console.log(code);
