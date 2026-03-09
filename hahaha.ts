import * as fs from "node:fs/promises";

console.log("starting ffi example");
let source: string = await fs.readFile("./package.json", "utf8");
console.log(source);
