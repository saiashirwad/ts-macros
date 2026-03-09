import { $, generate, MacroClass, numeric, type } from "./src";

class ScoreBoard extends MacroClass<ScoreBoard>("ScoreBoard")(function* () {
  const label = yield* $.classProperty("label", type.string());
  const score = yield* $.classProperty("score", type.number());

  yield* $.constructor(
    [$.p("label", type.string()), $.p("score", type.number())],
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
    { returnType: type.number() },
  );

  const describe = yield* $.classMethod(
    "describe",
    {},
    function* () {
      return $.template`${label}: ${score}`;
    },
    { returnType: type.string() },
  );

  return { bump, describe };
}) {}

const block = $.block(function* () {
  const ScoreBoardRef = yield* $.class(ScoreBoard);

  const { board, board2Incorrect } = yield* $.bind({
    board: $.new(ScoreBoardRef, ["tasks", 2]),
    // @ts-expect-error this should be oopsie
    board2Incorrect: $.new(ScoreBoardRef, [2, "tasks"]),
  });

  const a = yield* $.let("a", $.methodCall(board, "describe", []));
  //    ^?

  // @ts-expect-error this should be another oopsie
  $.new(ScoreBoardRef, []);
}).toBabelAST();

const { code } = generate(block);
console.log(code);
