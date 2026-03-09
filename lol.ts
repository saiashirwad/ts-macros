import { $, type, numeric, compare, logic, generate, VarRef } from "./src";

const block = $.block(function* () {
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

  const { userId } = yield* $.bind({
    userId: $.prop(user, "id"),
  });

  const { upperName } = yield* $.bind({
    upperName: $.methodCall(name, "toUpperCase", []),
  });

  const { isZero } = yield* $.bind({ isZero: compare.eq(count, 0) });
  const { isPositive } = yield* $.bind({ isPositive: compare.gt(count, 0) });

  const { status } = yield* $.bind({
    status: $.ternary(isZero, "empty", "has items"),
  });

  const maybeUser = new VarRef<{ name: string } | null>("maybeUser");
  const { maybeName } = yield* $.bind({
    maybeName: $.optionalProp(maybeUser, "name"),
  });

  const { user: user2 } = yield* $.bind({
    user: {
      id: 1,
      name: "Bob",
      email: "bob@example.com",
    },
  });

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

  yield* $.forOf("item", items, function* (item) {
    yield* $.expression($.methodCall(new VarRef<Console>("console"), "log", [item]));
  });

  yield* $.while(compare.lt(count, 10), function* () {
    yield* $.expression($.update("++", count));
  });

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

  yield* $.try(
    function* () {
      yield* $.throw($.new("Error", ["Something went wrong"]));
    },
    {
      catch: {
        param: "e",
        body: function* () {
          yield* $.expression(
            $.methodCall(new VarRef<Console>("console"), "error", [new VarRef("e")]),
          );
        },
      },
      finally: function* () {
        yield* $.expression($.methodCall(new VarRef<Console>("console"), "log", ["Cleanup"]));
      },
    },
  );

  yield* $.expression($.update("++", count));
  yield* $.expression($.update("--", count, true));

  yield* $.while($.bool(true), function* () {
    yield* $.if(compare.gt(count, 100), function* () {
      yield* $.break();
    });
    yield* $.continue();
  });
}).toBabelAST();

const { code } = generate(block);
console.log(code);
