import generate from "@babel/generator";
import { type, $ } from "./src";

const block = $.block(function* () {
  const Person = yield* $.class("Person", function* () {
    const nameField = yield* $.classProperty("name", type.string());
    const idField = yield* $.classProperty("id", type.number());

    yield* $.constructor(
      [$.p("name", type.string()), $.p("id", type.number())] as const,
      function* ({ name: initialName, id: initialId }) {
        yield* $.expression($.assign(nameField, initialName));
        yield* $.expression($.assign(idField, initialId));
      },
    );

    const greet = yield* $.classMethod("greet", [], function* () {
      const { message } = yield* $.bind({
        message: $.template(["Hello ", "!"], nameField),
      });
      return message;
    });

    return { name: nameField, greet };
  });
  const { p } = yield* $.bind({ p: Person.new("haha", 1) });
}).toBabelAST();

const { code } = generate(block);
console.log(code);
