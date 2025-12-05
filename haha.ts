import generate from "@babel/generator";
import { type, str, $ } from "./src";

const block = $.block(function* () {

  const User = yield* $.interface("User", {
    id: type.number(),
    name: type.string(),
    email: type.string(),
  });

  const fn = yield* $.function(
    "greet",
    [$.p("name", type.string()), $.p("age", type.number())],
    function* ({ name, age }) {
      const msg = yield* $.const("msg", str.concat("Hello, ", name));
      return yield* $.const('ha', { msg, age });
    }


  );

  const fn2 = yield* $.function('fn2',
    [$.p('user', User)],
    function* ({ user }) { }
  )
}).toBabelAST();

const { code } = generate(block);
console.log(code)
