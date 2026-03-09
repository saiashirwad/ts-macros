import { $, generate, type } from "./src";

const program = $.module(function* () {
  const fs = yield* $.ffi.import<typeof import("node:fs/promises")>("fs", "node:fs/promises");
  //    ^?
  const Console = $.ffi.global<typeof console>("console");
  //    ^?

  const source = yield* $.let(
    //  ^?
    "source",
    $.await($.call($.prop(fs, "readFile"), ["./w00t", "utf-8"])),
    type.string(),
  );

  yield* $.expression($.methodCall(Console, "log", [source]));
});

const { code } = generate(program.toBabelAST());

console.log(code);
