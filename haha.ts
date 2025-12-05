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
      return name
    }
  )
}).toBabelAST();

const { code } = generate(block);
console.log(code)
