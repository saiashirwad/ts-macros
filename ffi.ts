import { $, generate, type } from "./src";

const program = $.block(function* () {
  const fs = yield* $.ffi.import<typeof import("node:fs/promises")>("fs", "node:fs/promises");

  const Console = $.ffi.global<typeof console>("console");
  yield* $.expression($.methodCall(Console, "log", ["starting ffi example"]));

  const sourcePromise = yield* $.let(
    // ^?
    "source",
    $.call($.prop(fs, "readFile"), ["./package.json", "utf8"]),
    type.string(),
  );

  const source = yield* $.let(
    //  ^?
    "source",
    $.await($.call($.prop(fs, "readFile"), ["./package.json", "utf8"])),
    type.string(),
  );

  yield* $.expression($.methodCall(Console, "log", [source]));
});

const { code } = generate(program.toBabelAST());

console.log(code);
