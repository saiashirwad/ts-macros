import { $, type, str, numeric, compare, logic, generate, VarRef } from "./src";

const block = $.block(function* () {
  // === Variables ===
  const { count } = yield* $.bind.let({ count: 0 });
  const { name, items } = yield* $.bind({
    name: "Alice",
    items: $.array(["a", "b", "c"]),
  });
  const { user } = yield* $.bind({
    user: {
      id: 1,
      name: "Bob",
      email: "bob@example.com",
    },
  });

  // === Types ===
  const UserId = yield* $.type("UserId", type.string());
  const User = yield* $.interface("User", {
    id: type.number(),
    name: type.string(),
    email: type.string(),
    roles: type.array(type.string()),
  });

  // === Property access ===
  const { userId, userName } = yield* $.bind({
    userId: $.prop(user, "id"),
    userName: $.prop(user, "name"),
  });

  const { upperName } = yield* $.bind({
    upperName: $.methodCall(name, "toUpperCase", []),
  });
  const { ha } = yield* $.bind({ ha: $.prop(upperName, "length") });

  // === Template literals ===
  const { greeting } = yield* $.bind({
    greeting: $.template`Hello, ${name}! You have ${count} items.`,
  });

  // === Arithmetic ===
  const { doubled } = yield* $.bind({ doubled: numeric.multiply(count, 2) });
  const { sum } = yield* $.bind({ sum: numeric.add(count, 10) });

  // === Comparison ===
  const { isZero } = yield* $.bind({ isZero: compare.eq(count, 0) });
  const { isPositive } = yield* $.bind({ isPositive: compare.gt(count, 0) });

  // === Logic ===
  const { isValid } = yield* $.bind({ isValid: logic.and(isZero, isPositive) });
  const { hasValue } = yield* $.bind({ hasValue: $.not(isZero) });

  // === Ternary ===
  const { status } = yield* $.bind({
    status: $.ternary(isZero, "empty", "has items"),
  });

  // === Nullish coalescing ===
  const { fallback } = yield* $.bind({
    fallback: $.nullish(name, "Anonymous"),
  });

  // === Optional chaining ===
  const maybeUser = new VarRef<{ name: string } | null>("maybeUser");
  const { maybeName } = yield* $.bind({
    maybeName: $.optionalProp(maybeUser, "name"),
  });

  // === Type assertions ===
  const { typed } = yield* $.bind({ typed: $.as(count, type.number()) });

  const { user: user2 } = yield* $.bind({
    user: {
      id: 1,
      name: "Bob",
      email: "bob@example.com",
    },
  });

  const { checked } = yield* $.bind({
    checked: $.satisfies(
      user2,
      type.object({
        id: type.string(),
        name: type.string(),
      }),
    ),
  });

  const { checked: checked2 } = yield* $.bind({
    checked: $.satisfies(
      user2,
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    ),
  });

  // === Non-null assertion ===
  const { definitelyName } = yield* $.bind({
    definitelyName: $.nonNull(maybeName),
  });

  // === Control flow: if ===
  const itemsArr = new VarRef<string[]>("items");
  yield* $.if(
    isZero,
    function* () {
      yield* $.expression($.methodCall(itemsArr, "push", ["new item"]));
    },
    function* () {
      yield* $.expression($.assign(count, 0));
    },
  );

  // === Control flow: for-of ===
  yield* $.forOf("item", items, function* (item) {
    yield* $.expression(
      $.methodCall(new VarRef<Console>("console"), "log", [item]),
    );
  });

  // === Control flow: while ===
  yield* $.while(compare.lt(count, 10), function* () {
    yield* $.expression($.update("++", count));
  });

  // === Control flow: switch ===
  yield* $.switch(status, () => [
    $.case("empty", function* () {
      yield $.return("No items");
    }),
    $.case("has items", function* () {
      yield $.return("Has items");
    }),
    $.default(function* () {
      yield $.return("Unknown");
    }),
  ]);

  // === Try-catch ===
  yield* $.try(
    function* () {
      yield* $.throw($.new("Error", ["Something went wrong"]));
    },
    {
      catch: {
        param: "e",
        body: function* () {
          yield* $.expression(
            $.methodCall(new VarRef<Console>("console"), "error", [
              new VarRef("e"),
            ]),
          );
        },
      },
      finally: function* () {
        yield* $.expression(
          $.methodCall(new VarRef<Console>("console"), "log", ["Cleanup"]),
        );
      },
    },
  );

  // === Functions ===
  const add = yield* $.function(
    "add",
    [$.p("a", type.number()), $.p("b", type.number())],
    function* ({ a, b }) {
      return numeric.add(a, b);
    },
  );

  // === Arrow functions ===
  const double = yield* $.const(
    "double",
    $.arrow(
      [{ name: "x", tsType: type.number() }],
      numeric.multiply(new VarRef<number>("x"), 2),
      { returnType: type.number() },
    ),
  );

  // === Async functions ===
  yield* $.async(
    "fetchData",
    [$.p("url", type.string())],
    function* ({ url }) {
      const fetchFn = new VarRef<(input: string) => Promise<Response>>("fetch");
      const response = yield* $.const(
        "response",
        $.await($.call(fetchFn, [url as VarRef<string>])),
      );
      const responseCast = new VarRef<Response>("response");
      return $.methodCall(responseCast, "json", []);
    },
    { returnType: type.promise(type.unknown()) },
  );

  // === Classes ===
  const Person = yield* $.class("Person", function* () {
    yield* $.classProperty("name", {
      typeAnnotation: type.string(),
      accessibility: "private",
    });
    yield* $.classProperty("age", {
      typeAnnotation: type.number(),
      accessibility: "private",
    });
    yield* $.classMethod(
      "constructor",
      {
        name: type.string(),
        age: type.number(),
      },
      function* ({ name: n, age: a }) {
        const self = new VarRef<{ name: string; age: number }>("this");
        yield* $.expression($.assign($.prop(self, "name"), n));
        yield* $.expression($.assign($.prop(self, "age"), a));
      },
      { kind: "constructor" },
    );
    const greet = yield* $.classMethod(
      "greet",
      {},
      function* () {
        const self = new VarRef<{ name: string }>("this");
        return $.template`Hello, I'm ${$.prop(self, "name")}`;
      },
      { returnType: type.string(), accessibility: "public" },
    );
    const age = yield* $.classMethod(
      "age",
      {},
      function* () {
        const self = new VarRef<{ age: number }>("this");
        return $.prop(self, "age");
      },
      { kind: "get", returnType: type.number() },
    );

    return { greet, age };
  });

  // === Enums ===
  yield* $.enum("Status", [
    { id: "Pending" },
    { id: "Active", initializer: $.number(1) },
    { id: "Completed", initializer: $.number(2) },
  ]);

  // === Imports/Exports ===
  yield* $.import(
    [
      { default: "React" },
      { imported: "useState", local: "useState" },
      { imported: "useEffect" },
    ],
    "react",
  );

  yield* $.import([{ namespace: "path" }], "path");

  // === Spread ===
  const combined = yield* $.const(
    "combined",
    $.array([$.spread(itemsArr), "extra"]),
  );

  // === Update expressions ===
  yield* $.expression($.update("++", count));
  yield* $.expression($.update("--", count, true));

  // === Tagged template ===
  const sql = yield* $.const(
    "sql",
    $.taggedTemplate(
      "sql",
      $.template`SELECT * FROM users WHERE id = ${userId}`,
    ),
  );

  // === Namespace ===
  yield* $.namespace("Utils", function* () {
    yield* $.function("helper", [], function* () {
      return $.string("helped");
    });
  });

  // === Break/Continue (inside loops) ===
  yield* $.while($.bool(true), function* () {
    yield* $.if(compare.gt(count, 100), function* () {
      yield* $.break();
    });
    yield* $.continue();
  });
}).toBabelAST();

const { code } = generate(block);
console.log(code);
