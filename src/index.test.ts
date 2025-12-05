import { test, expect } from "bun:test";
import { $, type, str, numeric, compare, generate } from "./index";
import { isExpr, brand } from "./ir";
import { normalizeToExpression } from "./infer";
import type { Expression } from "./ir";

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

    const fn = yield* $.function(
      "greet",





      [$.p("name", type.string())],
      function* ({ name }) {
        const msg = yield* $.const("msg", str.concat("Hello, ", name));
        return yield* $.const('ha', { msg });
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

test("ternary expression", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", 5);
    const y = yield* $.const("y", $.ternary(x, "yes", "no"));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ? \"yes\" : \"no\"");
});

test("spread expression", () => {
  const block = $.block(function* () {
    const arr = yield* $.const("arr", [1, 2, 3]);
    const arr2 = yield* $.const("arr2", [0, $.spread(arr), 4]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("...arr");
});

test("nullish coalescing", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", null as number | null);
    const y = yield* $.const("y", $.nullish(x, 42));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ?? 42");
});

test("new expression", () => {
  const block = $.block(function* () {
    const date = yield* $.const("date", $.new("Date", []));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Date()");
});

test("new expression with args", () => {
  const block = $.block(function* () {
    const map = yield* $.const("map", $.new("Map", []));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Map()");
});

test("new expression with type arguments", () => {
  const block = $.block(function* () {
    const set = yield* $.const(
      "set",
      $.new("Set", [], [type.number()])
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("new Set<number>");
});

test("this expression", () => {
  const block = $.block(function* () {
    const self = yield* $.const("self", $.this());
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("this");
});

test("optional member expression", () => {
  const block = $.block(function* () {
    const obj = yield* $.const("obj", { name: "test" });
    const name = yield* $.const("name", $.optionalProp(obj, "name"));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("obj?.name");
});

test("optional call expression", () => {
  const block = $.block(function* () {
    const fn = yield* $.const("fn", null as (() => string) | null);
    const result = yield* $.const("result", $.optionalCall(fn, []));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("fn?.()");
});

test("as expression", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", $.as("hello", type.string()));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("\"hello\" as string");
});

test("satisfies expression", () => {
  const block = $.block(function* () {
    const obj = yield* $.const("obj", { name: "test" });
    const x = yield* $.const("x", $.satisfies(obj, type.object({ name: type.string() })));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("satisfies");
});

test("non-null expression", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", null as string | null);
    const y = yield* $.const("y", $.nonNull(x));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x!");
});

test("optional namespace - prop", () => {
  const block = $.block(function* () {
    const obj = yield* $.const("obj", { name: "test" });
    const name = yield* $.const("name", $.optional.prop(obj, "name"));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("obj?.name");
});

test("optional namespace - call", () => {
  const block = $.block(function* () {
    const fn = yield* $.const("fn", null as (() => string) | null);
    const result = yield* $.const("result", $.optional.call(fn, []));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("fn?.()");
});

test("arrow function - expression body", () => {
  const block = $.block(function* () {
    const add = yield* $.const(
      "add",
      $.arrow(
        [{ name: "x", tsType: type.number() }, { name: "y", tsType: type.number() }],
        brand({ type: "binary", left: brand({ type: "variable", name: "x" }), op: "+", right: brand({ type: "variable", name: "y" }) })
      )
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(x: number, y: number) => x + y");
});

test("arrow function - block body", () => {
  const block = $.block(function* () {
    const greet = yield* $.const(
      "greet",
      $.arrow(
        [{ name: "name", tsType: type.string() }],
        [
          { type: "return", value: brand({ type: "template", parts: ["Hello, ", "!"], expressions: [brand({ type: "variable", name: "name" })] }) }
        ]
      )
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(name: string) => {");
  expect(code).toContain("return `Hello, ${name}!`");
});

test("arrow function - async", () => {
  const block = $.block(function* () {
    const fetchData = yield* $.const(
      "fetchData",
      $.arrow(
        [{ name: "url", tsType: type.string() }],
        brand({ type: "variable", name: "url" }),
        { async: true }
      )
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("async (url: string) => url");
});

test("arrow function - with return type", () => {
  const block = $.block(function* () {
    const double = yield* $.const(
      "double",
      $.arrow(
        [{ name: "x", tsType: type.number() }],
        brand({ type: "binary", left: brand({ type: "variable", name: "x" }), op: "*", right: brand({ type: "literal", value: 2 }) }),
        { returnType: type.number() }
      )
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("(x: number): number => x * 2");
});

test("update expression - prefix increment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 0);
    const y = yield* $.const("y", $.update("++", x, true));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("++x");
});

test("update expression - postfix increment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 0);
    const y = yield* $.const("y", $.update("++", x, false));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x++");
});

test("update expression - prefix decrement", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 10);
    const y = yield* $.const("y", $.update("--", x, true));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("--x");
});

test("update expression - postfix decrement", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 10);
    const y = yield* $.const("y", $.update("--", x, false));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x--");
});

test("tagged template expression", () => {
  const block = $.block(function* () {
    const name = yield* $.const("name", "World");
    const result = yield* $.const(
      "result",
      $.taggedTemplate(
        "html",
        brand({ type: "template", parts: ["<h1>Hello, ", "!</h1>"], expressions: [brand({ type: "variable", name: "name" })] })
      )
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("html`<h1>Hello, ${name}!</h1>`");
});

test("assignment expression - basic assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 0);
    const result = yield* $.const("result", $.assign(x, 42));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x = 42");
});

test("assignment expression - add assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 10);
    const result = yield* $.const("result", $.assign(x, 5, "+="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x += 5");
});

test("assignment expression - subtract assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 10);
    const result = yield* $.const("result", $.assign(x, 3, "-="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x -= 3");
});

test("assignment expression - multiply assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 5);
    const result = yield* $.const("result", $.assign(x, 2, "*="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x *= 2");
});

test("assignment expression - divide assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 20);
    const result = yield* $.const("result", $.assign(x, 4, "/="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x /= 4");
});

test("assignment expression - modulo assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", 10);
    const result = yield* $.const("result", $.assign(x, 3, "%="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x %= 3");
});

test("assignment expression - logical and assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", true);
    const result = yield* $.const("result", $.assign(x, false, "&&="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x &&= false");
});

test("assignment expression - logical or assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", false);
    const result = yield* $.const("result", $.assign(x, true, "||="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ||= true");
});

test("assignment expression - nullish coalescing assignment", () => {
  const block = $.block(function* () {
    const x = yield* $.let("x", null as number | null);
    const result = yield* $.const("result", $.assign(x, 42, "??="));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("x ??= 42");
});

test("throw statement", () => {
  const block = $.block(function* () {
    yield* $.throw($.new("Error", ["Something went wrong"]));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("throw new Error(\"Something went wrong\")");
});

test("throw statement with variable", () => {
  const block = $.block(function* () {
    const err = yield* $.const("err", $.new("Error", ["Oops"]));
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
    const i = yield* $.let("i", 0);
    yield* $.while(i, function* () {
      const x = yield* $.const("x", numeric.add(i, 1));
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
    const i = yield* $.let("i", 0);
    yield* $.doWhile(function* () {
      const x = yield* $.const("x", numeric.add(i, 1));
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
    const x = yield* $.const("x", 2);
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const a = yield* $.const("a", "one");
        yield* $.break();
      }),
      $.case(2, function* () {
        const b = yield* $.const("b", "two");
        yield* $.break();
      }),
      $.case(3, function* () {
        const c = yield* $.const("c", "three");
        yield* $.break();
      })
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
    const x = yield* $.const("x", 5);
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const a = yield* $.const("a", "one");
        yield* $.break();
      }),
      $.default(function* () {
        const d = yield* $.const("d", "other");
        yield* $.break();
      })
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("switch (x)");
  expect(code).toContain("case 1:");
  expect(code).toContain("default:");
});

test("switch with fallthrough", () => {
  const block = $.block(function* () {
    const x = yield* $.const("x", 1);
    yield* $.switch(x, () => [
      $.case(1, function* () {
        const a = yield* $.const("a", "one");
      }),
      $.case(2, function* () {
        const b = yield* $.const("b", "two");
        yield* $.break();
      })
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
            const msg = yield* $.const("msg", "caught");
          }
        }
      }
    );
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("try {");
  expect(code).toContain("throw new Error(\"test\")");
  expect(code).toContain("catch (err)");
  expect(code).toContain("const msg");
});

test("try-finally", () => {
  const block = $.block(function* () {
    yield* $.try(
      function* () {
        const x = yield* $.const("x", 42);
      },
      {
        finally: function* () {
          const cleanup = yield* $.const("cleanup", "done");
        }
      }
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
            const msg = yield* $.const("msg", "caught");
          }
        },
        finally: function* () {
          const cleanup = yield* $.const("cleanup", "done");
        }
      }
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
            const msg = yield* $.const("msg", "caught");
          }
        }
      }
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
        $.classProperty("age", { typeAnnotation: type.number() })
      ]
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
        $.classMethod("constructor", { name: type.string(), age: type.number() }, function* ({ name, age }) {
          const assignName = yield* $.const("assignName", $.assign($.prop($.this(), "name"), name));
          const assignAge = yield* $.const("assignAge", $.assign($.prop($.this(), "age"), age));
        }, { kind: "constructor" })
      ]
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Person");
  expect(code).toContain("constructor(name: string, age: number)");
});

test("class with extends", () => {
  const block = $.block(function* () {
    yield* $.class("Animal", {
      body: [
        $.classProperty("name", { typeAnnotation: type.string() })
      ]
    });
    yield* $.class("Dog", {
      extends: "Animal",
      body: [
        $.classProperty("breed", { typeAnnotation: type.string() })
      ]
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Dog extends Animal");
});

test("class with static members", () => {
  const block = $.block(function* () {
    yield* $.class("Counter", {
      body: [
        $.classProperty("count", { value: 1, typeAnnotation: type.number(), static: true }),
        $.classMethod("increment", {}, function* () {
          return $.update("++", brand({ type: "member", object: brand({ type: "variable", name: "Counter" }), property: "count" }), true);
        }, { static: true })
      ]
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("static count: number = 1");
  expect(code).toContain("static increment()");
});

test("class with accessibility modifiers", () => {
  const block = $.block(function* () {
    yield* $.class("Account", {
      body: [
        $.classProperty("balance", { typeAnnotation: type.number(), accessibility: "private" }),
        $.classMethod("getBalance", {}, function* () {
          return $.prop($.this(), "balance");
        }, { accessibility: "public", returnType: type.number() })
      ]
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
        $.classProperty("_celsius", { typeAnnotation: type.number(), accessibility: "private" }),
        $.classMethod("celsius", {}, function* () {
          return $.prop($.this(), "_celsius");
        }, { kind: "get", returnType: type.number() }),
        $.classMethod("celsius", { value: type.number() }, function* ({ value }) {
          const assign = yield* $.const("assign", $.assign($.prop($.this(), "_celsius"), value));
        }, { kind: "set" })
      ]
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
      { id: "Pending", initializer: 2 }
    ]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("enum Status");
  expect(code).toContain("Active = 1");
  expect(code).toContain("Pending = 2");
});

test("const enum", () => {
  const block = $.block(function* () {
    yield* $.enum("Direction", ["North", "South", "East", "West"], { const: true });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const enum Direction");
});

test("import named specifiers", () => {
  const block = $.block(function* () {
    yield* $.import([{ imported: "foo" }, { imported: "bar", local: "baz" }], "./module");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("import { foo, bar as baz } from \"./module\"");
});

test("import default", () => {
  const block = $.block(function* () {
    yield* $.import.default("React", "react");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("import React from \"react\"");
});

test("import namespace", () => {
  const block = $.block(function* () {
    yield* $.import.namespace("fs", "node:fs");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("import * as fs from \"node:fs\"");
});

test("import type-only", () => {
  const block = $.block(function* () {
    yield* $.import([{ imported: "User" }], "./types", true);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("import type { User } from \"./types\"");
});

test("export named declaration", () => {
  const block = $.block(function* () {
    yield* $.export.named({ type: "const", name: "x", value: brand({ type: "literal", value: 42 }) } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export const x = 42");
});

test("export specifiers", () => {
  const block = $.block(function* () {
    yield* $.export.named([{ local: "foo" }, { local: "bar", exported: "baz" }]);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export { foo, bar as baz }");
});

test("export specifiers from source", () => {
  const block = $.block(function* () {
    yield* $.export.named([{ local: "User" }], "./types");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export { User } from \"./types\"");
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
      body: [{ type: "return", value: brand({ type: "literal", value: "hello" }) }]
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export default function greet()");
});

test("export all", () => {
  const block = $.block(function* () {
    yield* $.export.all("./utils");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export * from \"./utils\"");
});

test("export all as name", () => {
  const block = $.block(function* () {
    yield* $.export.all("./utils", "utils");
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("export * as utils from \"./utils\"");
});

test("namespace with body", () => {
  const block = $.block(function* () {
    yield* $.namespace("Utils", function* () {
      yield* $.const("x", 42);
      yield* $.const("y", "hello");
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("namespace Utils");
  expect(code).toContain("x: number = 42");
  expect(code).toContain("y: string = \"hello\"");
});

test("declare const", () => {
  const block = $.block(function* () {
    yield* $.declare({ type: "const", name: "global", value: brand({ type: "literal", value: "any" }) } as any);
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
      returnType: type.promise(type.reference("Response"))
    } as any);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("declare function fetch");
  expect(code).toContain("url: string");
});
