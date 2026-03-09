import { $, generate, numeric, type, VarRef } from "./src";

const condition: boolean = false;

class ScoreBoard extends $.class<ScoreBoard>("ScoreBoard")(function* () {
  const label = yield* $.classProperty("label", type.string());
  const score = yield* $.classProperty("score", type.number());

  yield* $.constructor(
    [$.p("label", type.string()), $.p("score", type.number())],
    function* ({ label: initialLabel, score: initialScore }) {
      const consoleRef = new VarRef<Console>("console");

      const hi = yield* $.let("hi", "what the heck");
      yield* $.expression($.methodCall(consoleRef, "log", [hi]));

      yield* $.expression($.assign(label, initialLabel));
      yield* $.expression($.assign(score, initialScore));
    },
  );

  const add = yield* $.classMethod("add", [$.p("amount", type.number())], function* ({ amount }) {
    const temp = yield* $.let("temp", numeric.add(score, amount));
    if (condition) {
      yield* $.expression($.assign(score, 5));
    } else {
      yield* $.expression($.assign(score, temp));
    }
    return score;
  });

  const describe = yield* $.classMethod("describe", [], function* () {
    return $.template`${label}: ${score}`;
  });

  return { add, describe };
}) {}

const block = $.block(function* () {
  yield* ScoreBoard;
  const someNum = yield* $.let("someNum", 3);

  const User = yield* $.interface("User", {
    name: type.string(),
  });

  const fn = yield* $.function(
    "fn",
    [$.p("scoreBoard", ScoreBoard), $.p("user", User)],
    function* ({ scoreBoard, user }) {
      const description = yield* $.let("description", $.methodCall(scoreBoard, "describe", []));
      const nextScore = yield* $.let("nextScore", $.methodCall(scoreBoard, "add", [2]));

      return {
        description,
        nextScore,
        user,
      };
    },
  );

  const num = yield* $.let("num", 4);

  const board = yield* $.let(
    "board",
    $.new(ScoreBoard, ["tasks", $.prop($.array(["hi"]), "length")]),
  );

  // const num = yield* $.let("num", 3);

  // const { board, board2Incorrect } = yield* $.bind({
  //   board: $.new(ScoreBoard, ["tasks", num]),
  //   // @ts-expect-error this is fine
  //   board2Incorrect: $.new(ScoreBoard, [num, "tasks"]),
  // });

  // const a = yield* $.let("a", $.methodCall(board, "describe", []));
  // //    ^?
  // const b = yield* $.let("b", $.methodCall(board, "add", [3]));
  // //    ^?
  // const summary = yield* $.let("summary", $.call(fn, [board]));
  // //     ^?
}).toBabelAST();

const { code } = generate(block);
console.log(code);
