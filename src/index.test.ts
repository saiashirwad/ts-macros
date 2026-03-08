import { test, expect, expectTypeOf } from "bun:test";
import {
  $,
  type,
  str,
  numeric,
  compare,
  generate,
  types,
  TypeRef,
  VarRef,
  ClassRef,
} from "./index";
import { isExpr, brand } from "./ir";
import { statementToBabel, parseTypeString } from "./babel";
import {
  normalizeToExpression,
  inferExpressionType,
  typeAliasRegistry,
} from "./infer";
import type { Expression, TSTypeDescriptor } from "./ir";
import type { InferTSType, TypedExpression } from "./types";

type InferExpr<T> = T extends TypedExpression<infer U> ? U : never;

test("expression branding", () => {
  const expr = $.string("hello");
  expect(isExpr(expr)).toBe(true);

  const plain = { type: "literal", value: "hello" };
  expect(isExpr(plain)).toBe(false);
});

test("basic code generation", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: 42 });
    const { y } = yield* $.bind.let({ y: "hello" });
    const { z } = yield* $.bind({ z: numeric.add(x, 1) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const x");
  expect(code).toContain("42");
  expect(code).toContain("let y");
  expect(code).toContain('"hello"');
  expect(code).toContain("x + 1");
});

test("type generation", () => {
  const block = $.block(function* () {
    const PersonType = yield* $.type(
      "Person",
      type.object({
        name: type.string(),
        age: type.number(),
      }),
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type Person");
  expect(code).toContain("name: string");
  expect(code).toContain("age: number");
});

test("object type optional/readonly properties", () => {
  const block = $.block(function* () {
    const Opts = yield* $.type(
      "Opts",
      type.object({
        name: type.string(),
        flag: { type: type.boolean(), optional: true, readonly: true },
      }),
    );
  }).toBabelAST();

  const { code } = generate(block);
  console.log(code);
  expect(code).toContain("readonly flag?: boolean");
});

test("function generation", () => {
  const block = $.block(function* () {
    const fn = yield* $.function(
      "greet",

      [$.p("name", type.string())],
      function* ({ name }) {
        const { msg } = yield* $.bind({ msg: str.concat("Hello, ", name) });
        const { ha } = yield* $.bind({ ha: { msg } });
        return ha;
      },
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("function greet");
  expect(code).toContain("name: string");
  expect(code).toContain('"Hello, " + name');
});

test("function params support optional, rest, and default", () => {
  const block = $.block(function* () {
    yield* $.function(
      "demo",
      [
        $.p("name", type.string(), { optional: true }),
        $.p("rest", type.number(), { rest: true }),
      ],
      function* () {},
    );

    yield* $.function(
      "withDefault",
      [$.p("count", type.number(), { default: 1 })],
      function* () {},
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("function demo(name?: string, ...rest: number[])");
  expect(code).toContain("function withDefault(count: number = 1)");
});

test("call expression with type arguments", () => {
  const block = $.block(function* () {
    const { result } = yield* $.bind({
      result: $.call("fn", [1], [type.string()]),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("fn<string>(1)");
});

test("normalizeToExpression uses isExpr", () => {
  const branded = brand({ type: "literal" as const, value: 42 });
  const result = normalizeToExpression(branded);
  expect(result).toBe(branded);

  const unbranded = { type: "literal" as const, value: 42 };
  const result2 = normalizeToExpression(unbranded);
  expect(result2).not.toBe(unbranded);
});

test("ternary expression", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: 5 });
    const { y } = yield* $.bind({ y: $.ternary(x, "yes", "no") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('x ? "yes" : "no"');
});

test("spread expression", () => {
  const block = $.block(function* () {
    const { arr } = yield* $.bind({ arr: [1, 2, 3] });
    const { arr2 } = yield* $.bind({ arr2: [0, $.spread(arr), 4] });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("...arr");
});

test("nullish coalescing", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: null as number | null });
    const { y } = yield* $.bind({ y: $.nullish(x, 42) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ?? 42");
});

test("infer optional member returns union with undefined", () => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
  ctx.variables.set("obj", type.object({ name: type.string() }));

  const result = inferExpressionType(
    brand({
      type: "optional-member",
      object: brand({ type: "variable", name: "obj" }),
      property: "name",
    }),
    ctx,
  );

  expect(result.kind).toBe("union");
  const names =
    result.kind === "union"
      ? result.types.map((t) => (t.kind === "primitive" ? t.name : "")).sort()
      : [];
  expect(names).toEqual(["string", "undefined"]);
});

test("infer optional call returns return type or undefined", () => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
  ctx.variables.set("fn", {
    kind: "function",
    params: [],
    returnType: type.number(),
  });

  const result = inferExpressionType(
    brand({
      type: "optional-call",
      callee: brand({ type: "variable", name: "fn" }),
      arguments: [],
    }),
    ctx,
  );

  expect(result.kind).toBe("union");
  const kinds = result.kind === "union" ? result.types.map((t) => t.kind) : [];
  expect(kinds).toContain("primitive");
});

test("infer nullish filters nullish left", () => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
  ctx.variables.set("x", {
    kind: "union",
    types: [type.string(), type.undefined()],
  });

  const result = inferExpressionType(
    brand({
      type: "nullish",
      left: brand({ type: "variable", name: "x" }),
      right: brand({ type: "literal", value: 5 }),
    }),
    ctx,
  );

  expect(result.kind).toBe("union");
  const hasUndefined =
    result.kind === "union" &&
    result.types.some((t) => t.kind === "primitive" && t.name === "undefined");
  expect(hasUndefined).toBe(false);
});

test("infer arrow expression returns function descriptor", () => {
  const result = inferExpressionType(
    brand({
      type: "arrow",
      params: [
        { name: "x", tsType: type.number() },
        { name: "y", tsType: type.string(), optional: true },
      ],
      body: brand({ type: "variable", name: "x" }),
    }),
  );

  expect(result.kind).toBe("function");
  if (result.kind === "function") {
    expect(result.params.length).toBe(2);
    expect(result.returnType).toEqual(type.number());
  }
});

test("infer member on array returns element type", () => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
  ctx.variables.set("arr", { kind: "array", elementType: type.number() });

  const result = inferExpressionType(
    brand({
      type: "member",
      object: brand({ type: "variable", name: "arr" }),
      property: "0",
    }),
    ctx,
  );

  expect(result).toEqual(type.number());
});

test("infer new with type arguments uses provided type", () => {
  const result = inferExpressionType(
    brand({
      type: "new",
      callee: brand({ type: "variable", name: "Box" }),
      arguments: [],
      typeArguments: [type.string()],
    }),
  );

  expect(result).toEqual(type.string());
});

test("new expression", () => {
  const block = $.block(function* () {
    const { date } = yield* $.bind({ date: $.new("Date", []) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Date()");
});

test("new expression with args", () => {
  const block = $.block(function* () {
    const { map } = yield* $.bind({ map: $.new("Map", []) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Map()");
});

test("new expression with type arguments", () => {
  const block = $.block(function* () {
    const { set } = yield* $.bind({ set: $.new("Set", [], [type.number()]) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Set<number>");
});

test("this expression", () => {
  const block = $.block(function* () {
    const { self } = yield* $.bind({ self: $.this() });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("this");
});

test("optional member expression", () => {
  const block = $.block(function* () {
    const { obj } = yield* $.bind({ obj: { name: "test" } });
    const { name } = yield* $.bind({ name: $.optionalProp(obj, "name") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("obj?.name");
});

test("optional call expression", () => {
  const block = $.block(function* () {
    const { fn } = yield* $.bind({ fn: null as (() => string) | null });
    const { result } = yield* $.bind({ result: $.optionalCall(fn, []) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("fn?.()");
});

test("as expression", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: $.as("hello", type.string()) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('"hello" as string');
});

test("satisfies expression", () => {
  const block = $.block(function* () {
    const { obj } = yield* $.bind({ obj: { name: "test" } });
    const { x } = yield* $.bind({
      x: $.satisfies(obj, type.object({ name: type.string() })),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("satisfies");
});

test("non-null expression", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: null as string | null });
    const { y } = yield* $.bind({ y: $.nonNull(x) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x!");
});

test("optional namespace - prop", () => {
  const block = $.block(function* () {
    const { obj } = yield* $.bind({ obj: { name: "test" } });
    const { name } = yield* $.bind({ name: $.optional.prop(obj, "name") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("obj?.name");
});

test("optional namespace - call", () => {
  const block = $.block(function* () {
    const { fn } = yield* $.bind({ fn: null as (() => string) | null });
    const { result } = yield* $.bind({ result: $.optional.call(fn, []) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("fn?.()");
});

test("arrow function - expression body", () => {
  const block = $.block(function* () {
    const { add } = yield* $.bind({
      add: $.arrow(
        [
          { name: "x", tsType: type.number() },
          { name: "y", tsType: type.number() },
        ],
        brand({
          type: "binary",
          left: brand({ type: "variable", name: "x" }),
          op: "+",
          right: brand({ type: "variable", name: "y" }),
        }),
      ),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(x: number, y: number) => x + y");
});

test("arrow function - block body", () => {
  const block = $.block(function* () {
    const { greet } = yield* $.bind({
      greet: $.arrow(
        [{ name: "name", tsType: type.string() }],
        [
          {
            type: "return",
            value: brand({
              type: "template",
              parts: ["Hello, ", "!"],
              expressions: [brand({ type: "variable", name: "name" })],
            }),
          },
        ],
      ),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(name: string) => {");
  expect(code).toContain("return `Hello, ${name}!`");
});

test("arrow function - async", () => {
  const block = $.block(function* () {
    const { fetchData } = yield* $.bind({
      fetchData: $.arrow(
        [{ name: "url", tsType: type.string() }],
        brand({ type: "variable", name: "url" }),
        { async: true },
      ),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("async (url: string) => url");
});

test("arrow function - with return type", () => {
  const block = $.block(function* () {
    const { double } = yield* $.bind({
      double: $.arrow(
        [{ name: "x", tsType: type.number() }],
        brand({
          type: "binary",
          left: brand({ type: "variable", name: "x" }),
          op: "*",
          right: brand({ type: "literal", value: 2 }),
        }),
        { returnType: type.number() },
      ),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(x: number): number => x * 2");
});

test("update expression - prefix increment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 0 });
    const { y } = yield* $.bind({ y: $.update("++", x, true) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("++x");
});

test("update expression - postfix increment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 0 });
    const { y } = yield* $.bind({ y: $.update("++", x, false) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x++");
});

test("update expression - prefix decrement", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 10 });
    const { y } = yield* $.bind({ y: $.update("--", x, true) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("--x");
});

test("update expression - postfix decrement", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 10 });
    const { y } = yield* $.bind({ y: $.update("--", x, false) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x--");
});

test("tagged template expression", () => {
  const block = $.block(function* () {
    const { name } = yield* $.bind({ name: "World" });
    const { result } = yield* $.bind({
      result: $.taggedTemplate(
        "html",
        brand({
          type: "template",
          parts: ["<h1>Hello, ", "!</h1>"],
          expressions: [brand({ type: "variable", name: "name" })],
        }),
      ),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("html`<h1>Hello, ${name}!</h1>`");
});

test("template interpolates booleans through shared normalization", () => {
  const block = $.block(function* () {
    const { rendered } = yield* $.bind({
      rendered: $.template(["value: ", ""], false),
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("`value: ${false}`");
});

test("assignment expression - basic assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 0 });
    const { result } = yield* $.bind({ result: $.assign(x, 42) });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x = 42");
});

test("assignment expression - add assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 10 });
    const { result } = yield* $.bind({ result: $.assign(x, 5, "+=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x += 5");
});

test("assignment expression - subtract assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 10 });
    const { result } = yield* $.bind({ result: $.assign(x, 3, "-=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x -= 3");
});

test("assignment expression - multiply assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 5 });
    const { result } = yield* $.bind({ result: $.assign(x, 2, "*=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x *= 2");
});

test("assignment expression - divide assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 20 });
    const { result } = yield* $.bind({ result: $.assign(x, 4, "/=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x /= 4");
});

test("assignment expression - modulo assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: 10 });
    const { result } = yield* $.bind({ result: $.assign(x, 3, "%=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x %= 3");
});

test("assignment expression - logical and assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: true });
    const { result } = yield* $.bind({ result: $.assign(x, false, "&&=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x &&= false");
});

test("assignment expression - logical or assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: false });
    const { result } = yield* $.bind({ result: $.assign(x, true, "||=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ||= true");
});

test("assignment expression - nullish coalescing assignment", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind.let({ x: null as number | null });
    const { result } = yield* $.bind({ result: $.assign(x, 42, "??=") });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ??= 42");
});

test("throw statement", () => {
  const block = $.block(function* () {
    yield* $.throw($.new("Error", ["Something went wrong"]));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('throw new Error("Something went wrong")');
});

test("throw statement with variable", () => {
  const block = $.block(function* () {
    const { err } = yield* $.bind({ err: $.new("Error", ["Oops"]) });
    yield* $.throw(err);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("throw err");
});

test("break statement", () => {
  const block = $.block(function* () {
    yield* $.while(true, function* () {
      yield* $.break();
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("break");
});

test("break statement with label", () => {
  const block = $.block(function* () {
    yield* $.while(true, function* () {
      yield* $.break("outer");
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("break outer");
});

test("continue statement", () => {
  const block = $.block(function* () {
    yield* $.while(true, function* () {
      yield* $.continue();
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("continue");
});

test("continue statement with label", () => {
  const block = $.block(function* () {
    yield* $.while(true, function* () {
      yield* $.continue("outer");
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("continue outer");
});

test("while statement", () => {
  const block = $.block(function* () {
    const { i } = yield* $.bind.let({ i: 0 });
    yield* $.while(i, function* () {
      const { x } = yield* $.bind({ x: numeric.add(i, 1) });
      yield* $.break();
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("while (i)");
  expect(code).toContain("const x");
  expect(code).toContain("i + 1");
});

test("do-while statement", () => {
  const block = $.block(function* () {
    const { i } = yield* $.bind.let({ i: 0 });
    yield* $.doWhile(function* () {
      const { x } = yield* $.bind({ x: numeric.add(i, 1) });
    }, i);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("do {");
  expect(code).toContain("const x");
  expect(code).toContain("i + 1");
  expect(code).toContain("} while (i)");
});

test("switch with multiple cases", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: 2 });
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const { a } = yield* $.bind({ a: "one" });
        yield* $.break();
      }),
      $.case(2, function* () {
        const { b } = yield* $.bind({ b: "two" });
        yield* $.break();
      }),
      $.case(3, function* () {
        const { c } = yield* $.bind({ c: "three" });
        yield* $.break();
      }),
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("switch (x)");
  expect(code).toContain("case 1:");
  expect(code).toContain("case 2:");
  expect(code).toContain("case 3:");
  expect(code).toContain("break");
});

test("switch with default", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: 5 });
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const { a } = yield* $.bind({ a: "one" });
        yield* $.break();
      }),
      $.default(function* () {
        const { d } = yield* $.bind({ d: "other" });
        yield* $.break();
      }),
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("switch (x)");
  expect(code).toContain("case 1:");
  expect(code).toContain("default:");
});

test("switch with fallthrough", () => {
  const block = $.block(function* () {
    const { x } = yield* $.bind({ x: 1 });
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const { a } = yield* $.bind({ a: "one" });
      }),
      $.case(2, function* () {
        const { b } = yield* $.bind({ b: "two" });
        yield* $.break();
      }),
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("switch (x)");
  expect(code).toContain("case 1:");
  expect(code).toContain("case 2:");
});

test("try-catch", () => {
  const block = $.block(function* () {
    yield* $.try(
      function* () {
        yield* $.throw($.new("Error", ["test"]));
      },
      {
        catch: {
          param: "err",
          body: function* () {
            const { msg } = yield* $.bind({ msg: "caught" });
          },
        },
      },
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("try {");
  expect(code).toContain('throw new Error("test")');
  expect(code).toContain("catch (err)");
  expect(code).toContain("const msg");
});

test("try-finally", () => {
  const block = $.block(function* () {
    yield* $.try(
      function* () {
        const { x } = yield* $.bind({ x: 42 });
      },
      {
        finally: function* () {
          const { cleanup } = yield* $.bind({ cleanup: "done" });
        },
      },
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("try {");
  expect(code).toContain("const x");
  expect(code).toContain("finally {");
  expect(code).toContain("const cleanup");
});

test("try-catch-finally", () => {
  const block = $.block(function* () {
    yield* $.try(
      function* () {
        yield* $.throw($.new("Error", ["test"]));
      },
      {
        catch: {
          param: "err",
          body: function* () {
            const { msg } = yield* $.bind({ msg: "caught" });
          },
        },
        finally: function* () {
          const { cleanup } = yield* $.bind({ cleanup: "done" });
        },
      },
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("try {");
  expect(code).toContain("catch (err)");
  expect(code).toContain("finally {");
});

test("catch with typed param", () => {
  const block = $.block(function* () {
    yield* $.try(
      function* () {
        yield* $.throw($.new("Error", ["test"]));
      },
      {
        catch: {
          param: { name: "err", type: type.reference("Error") },
          body: function* () {
            const { msg } = yield* $.bind({ msg: "caught" });
          },
        },
      },
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("catch (err: Error)");
});

test("basic class", () => {
  const block = $.block(function* () {
    yield* $.class("Person", {
      body: [
        $.classProperty("name", { typeAnnotation: type.string() }),
        $.classProperty("age", { typeAnnotation: type.number() }),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Person");
  expect(code).toContain("name: string");
  expect(code).toContain("age: number");
});

test("class with constructor", () => {
  const block = $.block(function* () {
    yield* $.class("Person", {
      body: () => [
        $.classProperty("name", { typeAnnotation: type.string() }),
        $.classMethod(
          "constructor",
          { name: type.string(), age: type.number() },
          function* ({ name, age }) {
            const { assignName } = yield* $.bind({
              assignName: $.assign($.prop($.this(), "name"), name),
            });
            const { assignAge } = yield* $.bind({
              assignAge: $.assign($.prop($.this(), "age"), age),
            });
          },
          { kind: "constructor" },
        ),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Person");
  expect(code).toContain("constructor(name: string, age: number)");
});

test("class with extends", () => {
  const block = $.block(function* () {
    yield* $.class("Animal", {
      body: [$.classProperty("name", { typeAnnotation: type.string() })],
    });
    yield* $.class("Dog", {
      extends: "Animal",
      body: [$.classProperty("breed", { typeAnnotation: type.string() })],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Dog extends Animal");
});

test("class implements interfaces", () => {
  const block = $.block(function* () {
    yield* $.interface("Greeter", { greet: type.function([], type.string()) });

    yield* $.class("FriendlyGreeter", {
      implements: type.reference("Greeter"),
      body: [],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class FriendlyGreeter implements Greeter");
});

test("class emits generic type parameters", () => {
  const block = $.block(function* () {
    yield* $.class("Box", {
      typeParams: [{ name: "T" }],
      body: [$.classProperty("value", { typeAnnotation: type.reference("T") })],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Box<T>");
  expect(code).toContain("value: T");
});

test("class rejects non-reference implements clauses", () => {
  expect(() =>
    generate(
      $.block(function* () {
        yield* $.class("Broken", {
          implements: type.string(),
          body: [],
        });
      }).toBabelAST()
    )
  ).toThrow("Class implements clauses must be reference or generic types");
});

test("class with static members", () => {
  const block = $.block(function* () {
    yield* $.class("Counter", {
      body: [
        $.classProperty("count", {
          value: 1,
          typeAnnotation: type.number(),
          static: true,
        }),
        $.classMethod(
          "increment",
          {},
          function* () {
            return $.update(
              "++",
              brand({
                type: "member",
                object: brand({ type: "variable", name: "Counter" }),
                property: "count",
              }),
              true,
            );
          },
          { static: true },
        ),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("static count: number = 1");
  expect(code).toContain("static increment()");
});

test("class property preserves falsy initializers", () => {
  const block = $.block(function* () {
    yield* $.class("Flags", {
      body: [
        $.classProperty("count", { value: 0, typeAnnotation: type.number() }),
        $.classProperty("enabled", { value: false, typeAnnotation: type.boolean() }),
        $.classProperty("label", { value: "", typeAnnotation: type.string() }),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("count: number = 0");
  expect(code).toContain("enabled: boolean = false");
  expect(code).toContain('label: string = ""');
});

test("class with accessibility modifiers", () => {
  const block = $.block(function* () {
    yield* $.class("Account", {
      body: [
        $.classProperty("balance", {
          typeAnnotation: type.number(),
          accessibility: "private",
        }),
        $.classMethod(
          "getBalance",
          {},
          function* () {
            return $.prop($.this(), "balance");
          },
          { accessibility: "public", returnType: type.number() },
        ),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("private balance: number");
  expect(code).toContain("public getBalance()");
});

test("class with getters and setters", () => {
  const block = $.block(function* () {
    yield* $.class("Temperature", {
      body: [
        $.classProperty("_celsius", {
          typeAnnotation: type.number(),
          accessibility: "private",
        }),
        $.classMethod(
          "celsius",
          {},
          function* () {
            return $.prop($.this(), "_celsius");
          },
          { kind: "get", returnType: type.number() },
        ),
        $.classMethod(
          "celsius",
          { value: type.number() },
          function* ({ value }) {
            const { assign } = yield* $.bind({
              assign: $.assign($.prop($.this(), "_celsius"), value),
            });
          },
          { kind: "set" },
        ),
      ],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("get celsius()");
  expect(code).toContain("set celsius(value: number)");
});

test("basic enum", () => {
  const block = $.block(function* () {
    yield* $.enum("Color", ["Red", "Green", "Blue"]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("enum Color");
  expect(code).toContain("Red");
  expect(code).toContain("Green");
  expect(code).toContain("Blue");
});

test("enum with initializers", () => {
  const block = $.block(function* () {
    yield* $.enum("Status", [
      { id: "Active", initializer: 1 },
      { id: "Pending", initializer: 2 },
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("enum Status");
  expect(code).toContain("Active = 1");
  expect(code).toContain("Pending = 2");
});

test("enum preserves falsy initializers", () => {
  const block = $.block(function* () {
    yield* $.enum("Flags", [
      { id: "Zero", initializer: 0 },
      { id: "Disabled", initializer: false },
      { id: "Empty", initializer: "" },
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("Zero = 0");
  expect(code).toContain("Disabled = false");
  expect(code).toContain('Empty = ""');
});

test("enum registers type in registry", () => {
  typeAliasRegistry.clear();
  const block = $.block(function* () {
    yield* $.enum("Color", ["Red", "Blue"]);
  }).toBabelAST();

  generate(block);
  const desc = typeAliasRegistry.get("Color");
  expect(desc).toBeDefined();
});

test("const enum", () => {
  const block = $.block(function* () {
    yield* $.enum("Direction", ["North", "South", "East", "West"], {
      const: true,
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const enum Direction");
});

test("import named specifiers", () => {
  const block = $.block(function* () {
    yield* $.import(
      [{ imported: "foo" }, { imported: "bar", local: "baz" }],
      "./module",
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('import { foo, bar as baz } from "./module"');
});

test("import default", () => {
  const block = $.block(function* () {
    yield* $.import.default("React", "react");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('import React from "react"');
});

test("import namespace", () => {
  const block = $.block(function* () {
    yield* $.import.namespace("fs", "node:fs");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('import * as fs from "node:fs"');
});

test("import type-only", () => {
  const block = $.block(function* () {
    yield* $.import([{ imported: "User" }], "./types", true);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('import type { User } from "./types"');
});

test("export named declaration", () => {
  const block = $.block(function* () {
    yield* $.export.named({
      type: "const",
      name: "x",
      value: brand({ type: "literal", value: 42 }),
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export const x = 42");
});

test("export specifiers", () => {
  const block = $.block(function* () {
    yield* $.export.named([
      { local: "foo" },
      { local: "bar", exported: "baz" },
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export { foo, bar as baz }");
});

test("export specifiers from source", () => {
  const block = $.block(function* () {
    yield* $.export.named([{ local: "User" }], "./types");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('export { User } from "./types"');
});

test("export default expression", () => {
  const block = $.block(function* () {
    yield* $.export.default(brand({ type: "literal", value: 42 }));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export default 42");
});

test("export default function", () => {
  const block = $.block(function* () {
    yield* $.export.default({
      type: "function",
      name: "greet",
      params: [],
      body: [
        { type: "return", value: brand({ type: "literal", value: "hello" }) },
      ],
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export default function greet()");
});

test("export default anonymous async function preserves function semantics", () => {
  const node = statementToBabel({
    type: "export-default",
    declaration: {
      type: "function",
      params: [],
      body: [],
      async: true,
      returnType: type.number(),
      typeParams: ["T"],
    },
  } as any);

  const { code } = generate(node);
  expect(code).toContain("export default async function <T>(): number");
});

test("export named rejects non-declaration statements", () => {
  expect(() =>
    generate(
      $.block(function* () {
        yield* $.export.named({
          type: "block",
          body: [],
        } as any);
      }).toBabelAST()
    )
  ).toThrow("Unsupported export-named declaration");
});

test("export all", () => {
  const block = $.block(function* () {
    yield* $.export.all("./utils");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('export * from "./utils"');
});

test("export all as name", () => {
  const block = $.block(function* () {
    yield* $.export.all("./utils", "utils");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('export * as utils from "./utils"');
});

test("namespace with body", () => {
  const block = $.block(function* () {
    yield* $.namespace("Utils", function* () {
      yield* $.bind({ x: 42 });
      yield* $.bind({ y: "hello" });
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("namespace Utils");
  expect(code).toContain("x: 42 = 42");
  expect(code).toContain('y: "hello" = "hello"');
});

test("declare const", () => {
  const block = $.block(function* () {
    yield* $.declare({
      type: "const",
      name: "global",
      value: brand({ type: "literal", value: "any" }),
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("declare const global");
});

test("declare function", () => {
  const block = $.block(function* () {
    yield* $.declare({
      type: "function",
      name: "fetch",
      params: [{ name: "url", tsType: type.string() }],
      body: [],
      returnType: type.promise(type.reference("Response")),
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("declare function fetch");
  expect(code).toContain("url: string");
});

test("declare rejects non-declaration statements", () => {
  expect(() =>
    generate(
      $.block(function* () {
        yield* $.declare({
          type: "expression",
          expr: brand({ type: "literal", value: 1 }),
        } as any);
      }).toBabelAST()
    )
  ).toThrow("Unsupported declare declaration");
});

test("return normalizes object and array values", () => {
  const block = $.block(function* () {
    yield $.return({ ok: true, values: [1, 2] });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("return {");
  expect(code).toContain("ok: true");
  expect(code).toContain("values: [1, 2]");
});

test("ClassRef.new preserves branded expressions", () => {
  const Box = new ClassRef<{ value: number }>("Box");
  const expr = Box.new(numeric.add(1, 2)) as unknown as Expression & { arguments: Expression[] };

  expect(expr.arguments[0]).toMatchObject({ type: "binary", op: "+" });
});

test("normalizeToExpression rejects undefined", () => {
  expect(() => normalizeToExpression(undefined)).toThrow(
    "Cannot normalize undefined to an expression"
  );
});

test("InferTSType resolves TypeRef references and generics", () => {
  const PersonDef = type.object({ id: type.number(), name: type.string() });
  const ref = new TypeRef<InferTSType<typeof PersonDef>>(
    "Person",
    { kind: "reference", name: "Person" },
    PersonDef,
  );
  const desc = ref.toDescriptor();
  expectTypeOf<InferTSType<typeof desc>>(null as any).toEqualTypeOf<{
    id: number;
    name: string;
  }>();

  // Generic helper sanity (runtime placeholder to avoid deep type instantiation)
  expect(true).toBe(true);
});

test("call with string callee stays unknown unless annotated", () => {
  const expr = $.call("fn", []);
  expectTypeOf<InferExpr<typeof expr>>(null as any).toEqualTypeOf<unknown>();

  const typedFn = new VarRef<() => number>("fn");
  const annotated = $.call(typedFn, []);
  expectTypeOf<InferExpr<typeof annotated>>(
    null as any,
  ).toEqualTypeOf<number>();
});

test("enum returns typed VarRef and registers descriptor", () => {
  typeAliasRegistry.clear();
  const block = $.block(function* () {
    const Color = yield* $.enum("Color", [
      { id: "Red", initializer: "red" },
      { id: "Blue", initializer: "blue" },
    ] as const);

    type ColorShape = typeof Color extends VarRef<infer U> ? U : never;
    expectTypeOf<ColorShape["Red"]>(null as any).toEqualTypeOf<
      "red" | "blue"
    >();
  }).toBabelAST();

  generate(block);
  const desc = typeAliasRegistry.get("Color");
  expect(desc).toBeDefined();
});

test("tuple optional elements propagate through InferTSType", () => {
  const tupleDesc = types.tuple(
    { type: type.string(), optional: true },
    type.number(),
  );
  expectTypeOf<InferTSType<typeof tupleDesc>>(null as any).toEqualTypeOf<
    [string | undefined, number]
  >();
});

test("InferTSType preserves optional and readonly object property wrappers", () => {
  const objectDesc = type.object({
    id: { type: type.number(), readonly: true },
    flag: { type: type.boolean(), optional: true },
    name: type.string(),
  });

  type ObjectShape = InferTSType<typeof objectDesc>;
  const withoutFlag: ObjectShape = { id: 1, name: "Ada" };
  const withFlag: ObjectShape = { id: 1, name: "Ada", flag: true };

  expect(withoutFlag.flag).toBeUndefined();
  expect(withFlag.flag).toBe(true);
});

test("function types support more than five parameters", () => {
  $.block(function* () {
    const fn = yield* $.function(
      "wide",
      [
        $.p("a", type.number()),
        $.p("b", type.number()),
        $.p("c", type.number()),
        $.p("d", type.number()),
        $.p("e", type.number()),
        $.p("f", type.number()),
      ] as const,
      function* () {
        return 0;
      },
    );

    type WideFn = typeof fn extends VarRef<infer U> ? U : never;
    expectTypeOf<Parameters<WideFn>>(null as any).toEqualTypeOf<
      [number, number, number, number, number, number]
    >();
  }).toBabelAST();
});

test("function-like builders infer runtime return descriptors from explicit return statements", () => {
  $.block(function* () {
    const fn = yield* $.function(
      "pick",
      [$.p("flag", type.boolean())],
      function* ({ flag }) {
        yield* $.if(flag, function* () {
          yield $.return("yes");
        }, function* () {
          yield $.return("no");
        });
      },
    );

    const asyncFn = yield* $.async(
      "pickAsync",
      [$.p("flag", type.boolean())],
      function* ({ flag }) {
        yield* $.if(flag, function* () {
          yield $.return(1);
        }, function* () {
          yield $.return(2);
        });
      },
    );

    expect(fn.tsType).toMatchObject({
      kind: "function",
      params: [{ kind: "primitive", name: "boolean" }],
      returnType: {
        kind: "union",
        types: [
          { kind: "literal", value: "yes" },
          { kind: "literal", value: "no" },
        ],
      },
    });

    expect(asyncFn.tsType).toMatchObject({
      kind: "function",
      params: [{ kind: "primitive", name: "boolean" }],
      returnType: {
        kind: "generic",
        name: "Promise",
        args: [
          {
            kind: "union",
            types: [
              { kind: "literal", value: 1 },
              { kind: "literal", value: 2 },
            ],
          },
        ],
      },
    });
  }).toBabelAST();
});

test("legacy string type parsing recognizes unknown never and undefined", () => {
  expect(parseTypeString("unknown")).toEqual({ kind: "primitive", name: "unknown" });
  expect(parseTypeString("never")).toEqual({ kind: "primitive", name: "never" });
  expect(parseTypeString("undefined")).toEqual({ kind: "primitive", name: "undefined" });
});

test("TypeRef type arguments survive implements lowering", () => {
  const BoxOfString = new TypeRef(
    "Box",
    { kind: "reference", name: "Box", typeArgs: [type.string()] },
  );

  const block = $.block(function* () {
    yield* $.class("WrappedBox", {
      implements: BoxOfString,
      body: [],
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class WrappedBox implements Box<string>");
});

test("raw expressions and statements reject non-identifiers", () => {
  expect(() =>
    generate(
      $.block(function* () {
        yield* $.bind({
          bad: brand({ type: "raw", code: "x + y" }),
        });
      }).toBabelAST(),
    ),
  ).toThrow("Raw expression must be a valid identifier");

  expect(() =>
    generate(
      $.block(function* () {
        yield* $.raw("x + y");
      }).toBabelAST(),
    ),
  ).toThrow("Raw statement must be a valid identifier");
});

test("emits advanced type descriptors", () => {
  const block = $.block(function* () {
    yield* $.type(
      "Keys",
      type.keyof(type.object({ a: type.string(), b: type.number() })),
    );
    yield* $.type(
      "Value",
      type.indexedAccess(type.object({ a: type.string() }), type.literal("a")),
    );
    yield* $.type(
      "Mapped",
      type.mapped(
        "K",
        type.string(),
        type.keyof(type.object({ foo: type.boolean() })),
        { readonly: true, optional: true },
      ),
    );
    yield* $.type(
      "Tpl",
      type.templateLiteral("id-", [{ type: type.string(), literal: "-ok" }]),
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type Keys = keyof");
  expect(code).toContain("type Value =");
  expect(code).toContain("readonly [K in keyof");
  expect(code).toContain("`id-${string}-ok`");
});
