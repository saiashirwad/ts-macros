import { test, expect } from "bun:test";
import { $, type, str, numeric, generate } from "./index";
import { isExpr, brand } from "./ir";
import { normalizeToExpression } from "./infer";

test("expression branding", () => {
  const expr = $.string("hello");
  expect(isExpr(expr)).toBe(true);

  const plain = { type: "literal", value: "hello" };
  expect(isExpr(plain)).toBe(false);
});

test("basic code generation", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", 42);
    const y = yield* $.let("y", "hello");
    const z = yield* $.const("z", numeric.add(x, 1));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const x");
  expect(code).toContain("42");
  expect(code).toContain("let y");
  expect(code).toContain("\"hello\"");
  expect(code).toContain("x + 1");
});

test("type generation", () => {
  const block = $.block(function* () {
    const PersonType = yield* $.type(
      "Person",
      type.object({
        name: type.string(),
        age: type.number(),
      })
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type Person");
  expect(code).toContain("name: string");
  expect(code).toContain("age: number");
});

test("function generation", () => {
  const block = $.block(function* () {
    yield* $.function(
      "greet",
      { name: type.string() },
      function* ({ name }) {
        const msg = yield* $.const("msg", str.concat("Hello, ", name));
        return msg;
      }
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("function greet");
  expect(code).toContain("name: string");
  expect(code).toContain("\"Hello, \" + name");
});

test("normalizeToExpression uses isExpr", () => {
  const branded = brand({ type: "literal" as const, value: 42 });
  const result = normalizeToExpression(branded);
  expect(result).toBe(branded);

  const unbranded = { type: "literal" as const, value: 42 };
  const result2 = normalizeToExpression(unbranded);
  expect(result2).not.toBe(unbranded);
});
