import { $, generate, numeric, type } from "./src";

class ScoreBoard extends $.class<ScoreBoard>("ScoreBoard")(function* () {
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
    [],
    function* () {
      yield* $.expression($.assign(score, numeric.add(score, 1)));
      return score;
    },
    { returnType: type.number() },
  );

  const add = yield* $.classMethod(
    "add",
    [$.p("amount", type.number())],
    function* ({ amount }) {
      yield* $.expression($.assign(score, numeric.add(score, amount)));
      return score;
    },
    { returnType: type.number() },
  );

  const describe = yield* $.classMethod(
    "describe",
    [],
    function* () {
      return $.template`${label}: ${score}`;
    },
    { returnType: type.string() },
  );

  return { bump, add, describe };
}) {}

const block = $.block(function* () {
  const ScoreBoardRef = yield* ScoreBoard;

  const { board, board2Incorrect } = yield* $.bind({
    board: $.new(ScoreBoardRef, ["tasks", 2]),
    // @ts-expect-error this should be oopsie
    board2Incorrect: $.new(ScoreBoardRef, [2, "tasks"]),
  });

  const a = yield* $.let("a", $.methodCall(board, "describe", []));
  const b = yield* $.let("b", $.methodCall(board, "add", [3]));
  //    ^?

  // @ts-expect-error this should be another oopsie
  $.new(ScoreBoardRef, []);
}).toBabelAST();

const { code } = generate(block);
console.log(code);
