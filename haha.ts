import generate from "@babel/generator";
import { type, str, $ } from "./src";

const block = $.block(function* () {
  const User = yield* $.interface("User", {
    id: type.number(),
    name: type.string(),
    email: type.string(),
  });


  const fn2 = yield* $.function('fn2',
    [$.p('user', User)],
    function* ({ user }) {
      const name = yield* $.const("name", $.prop(user, 'name'))
      const id = yield* $.const("id", $.prop(user, 'id'))
      const result = yield* $.const('result', $.object({ name, id }))

      return result
    }
  )

  const Person = yield* $.class("Person", {
    implements: [User],
    body: function* () {
      const thisType = User;
      const nameField = yield* $.classProperty("name", { accessibility: "public", readonly: true, typeAnnotation: type.string() });
      const idField = yield* $.classProperty("id", { accessibility: "private", readonly: true, typeAnnotation: type.number() });
      yield $.classMethod(
        "constructor",
        { name: type.string(), id: type.number() },
        function* ({ name, id }, this_) {
          yield* $.expression($.assign($.prop(this_, nameField.name), name));
          yield* $.expression($.assign($.prop(this_, idField.name), id));
        },
        {
          kind: "constructor",
          thisType
        }
      );
      yield $.classMethod(
        "greet",
        {},
        function* (_, this_) {
          const message = yield* $.const("message", $.template(["Hello ", "!"], $.prop(this_, nameField.name)));
          return message;
        },
        {
          thisType
        }
      );
    }
  });
}).toBabelAST();

const { code } = generate(block);
console.log(code)
