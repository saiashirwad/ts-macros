import { $, generate, numeric, type } from "./src";

const block = $.block(function* () {
  const ScoreBoard = yield* $.class(
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
          const temp = yield* $.let("temp", numeric.add(score, amount));
          yield* $.expression($.assign(score, temp));
          return score;
        },
      );

      const describe = yield* $.classMethod("describe", [], function* () {
        return $.template`${label}: ${score}`;
      });

      return { bump, add, describe };
    }) {},
  );
});
