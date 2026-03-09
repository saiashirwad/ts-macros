import { $, generate, MacroClass, numeric, type } from "./src";

class ScoreBoard extends MacroClass<ScoreBoard>("ScoreBoard")({
  impl: function* () {
    const label = yield* $.classProperty("label", type.string());
    const score = yield* $.classProperty("score", type.number());

    return { label, score };
  },
  build: function* (self) {
    yield* $.constructor(
      [$.p("label", type.string()), $.p("score", type.number())],
      function* ({ label, score }) {
        yield* $.expression($.assign(self.label, label));
        yield* $.expression($.assign(self.score, score));
      },
    );

    const bump = yield* $.classMethod(
      "bump",
      {},
      function* () {
        yield* $.expression($.assign(self.score, numeric.add(self.score, 1)));
        return self.score;
      },
      { returnType: type.number() },
    );

    const describe = yield* $.classMethod(
      "describe",
      {},
      function* () {
        return $.template`${self.label}: ${self.score}`;
      },
      { returnType: type.string() },
    );

    return { bump, describe };
  },
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
