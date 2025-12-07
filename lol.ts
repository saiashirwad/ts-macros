import {
  $,
  type,
  str,
  numeric,
  compare,
  logic,
  generate,
  createInterface,
  createTypeAlias,
  VarRef,
} from "./src";

const block = $.block(function* () {
  // === Variables ===
  const count = yield* $.let("count", 0);
  const name = yield* $.const("name", "Alice");
  const items = yield* $.const("items", $.array(["a", "b", "c"]));
  const user = yield* $.const(
    "user",
    $.object({
      id: 1,
      name: "Bob",
      email: "bob@example.com",
    }),
  );

  // === Types ===
  const UserId = yield* $.type("UserId", type.string());
  const User = yield* $.interface("User", {
    id: type.number(),
    name: type.string(),
    email: type.string(),
    roles: type.array(type.string()),
  });

  // === Property access ===
  const userId = yield* $.const("userId", $.prop(user, "id"));
  const userName = yield* $.const("userName", $.prop(user, "name"));

  const upperName = yield* $.const(
    "upperName",
    $.methodCall(name, "toUpperCase", []),
  );
  const ha = yield* $.const("ha", $.prop(upperName, "length"));

  // === Template literals ===
  const greeting = yield* $.const(
    "greeting",
    $.template`Hello, ${name}! You have ${count} items.`,
  );

  // === Arithmetic ===
  const doubled = yield* $.const("doubled", numeric.multiply(count, 2));
  const sum = yield* $.const("sum", numeric.add(count, 10));

  // === Comparison ===
  const isZero = yield* $.const("isZero", compare.eq(count, 0));
  const isPositive = yield* $.const("isPositive", compare.gt(count, 0));

  // === Logic ===
  const isValid = yield* $.const("isValid", logic.and(isZero, isPositive));
  const hasValue = yield* $.const("hasValue", $.not(isZero));

  // === Ternary ===
  const status = yield* $.const(
    "status",
    $.ternary(isZero, "empty", "has items"),
  );

  // === Nullish coalescing ===
  const fallback = yield* $.const("fallback", $.nullish(name, "Anonymous"));

  // === Optional chaining ===
  const maybeUser = new VarRef<{ name: string } | null>("maybeUser");
  const maybeName = yield* $.const(
    "maybeName",
    $.optionalProp(maybeUser, "name"),
  );

  // === Type assertions ===
  const typed = yield* $.const("typed", $.as(count, type.number()));

  const user2 = yield* $.const("user", {
    id: 1,
    name: "Bob",
    email: "bob@example.com",
  });

  const checked = yield* $.const(
    "checked",
    $.satisfies(
      user2,
      type.object({
        id: type.string(),
        name: type.string(),
      }),
    ),
  );

  const checked2 = yield* $.const(
    "checked",
    $.satisfies(
      user2,
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    ),
  );

  // === Non-null assertion ===
  const definitelyName = yield* $.const("definitelyName", $.nonNull(maybeName));

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
  yield* $.class("Person", {
    body: [
      $.classProperty("name", {
        typeAnnotation: type.string(),
        accessibility: "private",
      }),
      $.classProperty("age", {
        typeAnnotation: type.number(),
        accessibility: "private",
      }),
      $.classMethod(
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
      ),
      $.classMethod(
        "greet",
        {},
        function* () {
          const self = new VarRef<{ name: string }>("this");
          return $.template`Hello, I'm ${$.prop(self, "name")}`;
        },
        { returnType: type.string(), accessibility: "public" },
      ),
      $.classMethod(
        "age",
        {},
        function* () {
          const self = new VarRef<{ age: number }>("this");
          return $.prop(self, "age");
        },
        { kind: "get", returnType: type.number() },
      ),
    ],
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

  // === Raw code ===
  yield* $.raw("// This is a raw statement");

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
