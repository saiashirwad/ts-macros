import generate from "@babel/generator";
import { type, str, $ } from "./src";

const block = $.block(function* () {
  const Person = yield* $.class("Person", function* () {
    const nameField = yield* $.classProperty("name", type.string());
    const idField = yield* $.classProperty("id", type.number());

    yield* $.constructor(
      [$.p("name", type.string()), $.p("id", type.number())] as const,
      function* ({ name, id }) {
        yield* $.expression($.assign(nameField, name));
        yield* $.expression($.assign(idField, id));
      },
    );

    const greet = yield* $.classMethod("greet", {}, function* (_, this_) {
      const { message } = yield* $.bind({
        message: $.template(["Hello ", "!"], $.prop(this_, nameField.name)),
      });
      return message;
    });

    return { nameField, greet };
  });
  const { p } = yield* $.bind({ p: Person.new("haha", 1) });
}).toBabelAST();

const { code } = generate(block);
console.log(code);
