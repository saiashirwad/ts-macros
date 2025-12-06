import generate from "@babel/generator";
import { type, str, $ } from "./src";

const block = $.block(function* () {
  const Person = yield* $.class("Person", function* () {
    const nameField = yield* $.classProperty("name", type.string());
    const idField = yield* $.classProperty("id", type.number());

    yield $.classMethod(
      "constructor",
      { name: type.string(), id: type.number() },
      function* ({ name, id }, this_) {
        yield* $.assignProps(this_, {
          [nameField.name]: name,
          [idField.name]: id,
        });
      },
    );

    const greet = yield* $.classMethod("greet", {}, function* (_, this_) {
      const message = yield* $.const(
        "message",
        $.template(["Hello ", "!"], $.prop(this_, nameField.name)),
      );
      return message;
    });

    return { nameField, greet };
  });
  const p = yield* $.const("p", Person.new("haha", 1));
}).toBabelAST();

const { code } = generate(block);
console.log(code);
