import { $, type, str, numeric, generate } from "./src";

const block = $.block(function* () {
  const b = yield* $.const("b", 2);
  const a = yield* $.const(
    "a",
    $.object({
      hi: "there",
      properties: $.object({
        foo: $.object({ a: "b", c: "d" }),
      }),
    }),
  );
}).toBabelAST();

const { code } = generate(block);
console.log(code);
