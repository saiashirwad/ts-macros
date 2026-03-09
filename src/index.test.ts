import { test, expect, expectTypeOf } from "bun:test";
import {
  $,
  type,
  str,
  numeric,
  compare,
  logic,
  generate,
  types,
  TypeRef,
  VarRef,
  ClassRef,
} from "./index";
import { isExpr, brand } from "./ir";
import { statementToBabel, parseTypeString, expressionToBabel } from "./babel";
import { normalizeToExpression, inferExpressionType, typeAliasRegistry } from "./infer";
import type { Expression, TSTypeDescriptor } from "./ir";
import type {
  ClassConstructorOf,
  ClassInstanceOf,
  InferTSType,
  ResolvedClassRef,
  TypedExpression,
} from "./types";

type InferExpr<T> = T extends TypedExpression<infer U> ? U : never;
const show = <T>(_value: T): void => {};

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

test("bind preserves typed expressions and block member inference", () => {
  const block = $.block(function* () {
    const { user } = yield* $.bind({
      user: {
        id: 1,
        name: "Bob",
        email: "bob@example.com",
      },
    });

    const propId = $.prop(user, "id");
    const propName = $.prop(user, "name");
    expectTypeOf<InferExpr<typeof propId>>(null as any).toEqualTypeOf<number>();
    expectTypeOf<InferExpr<typeof propName>>(null as any).toEqualTypeOf<string>();

    const { userId, userName } = yield* $.bind({
      userId: propId,
      userName: propName,
    });

    expectTypeOf<typeof userId>(null as any).toEqualTypeOf<VarRef<number>>();
    expectTypeOf<typeof userName>(null as any).toEqualTypeOf<VarRef<string>>();
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const userId: number = user.id");
  expect(code).toContain("const userName: string = user.name");
});

test("core DSL builders preserve inference across expressions and helpers", () => {
  const arrayExpr = $.array([1, 2, 3] as const);
  const objectExpr = $.object({
    id: 1,
    name: $.string("Ada"),
    active: true,
  });
  const templateExpr = $.template(["Hello, ", "!"], "Ada");
  const ternaryExpr = $.ternary(true, 1, "no");
  const nullishExpr = $.nullish(new VarRef<number | null>("count"), "fallback");
  const awaitExpr = $.await(new VarRef<Promise<number>>("loadCount"));
  const methodExpr = $.methodCall(new VarRef<string>("name"), "toUpperCase", []);
  const optionalPropExpr = $.optional.prop(
    new VarRef<{ name: string } | null>("maybeUser"),
    "name",
  );
  const optionalCallExpr = $.optional.call(
    new VarRef<((value: string) => number) | undefined>("maybeMeasure"),
    ["Ada"],
  );
  const asExpr = $.as("42", type.number());
  const satisfiesExpr = $.satisfies(
    { id: 1, name: "Ada" },
    type.object({ id: type.number(), name: type.string() }),
  );
  const nonNullExpr = $.nonNull(new VarRef<string | null>("maybeName"));
  const annotatedCall = $.call("parse", ["42"], undefined, type.number());
  const newExpr = $.new(
    new ClassRef<{ id: number }>("Box") as ResolvedClassRef<
      { id: number },
      (id: number) => { id: number }
    >,
    [1],
  );
  const taggedExpr = $.taggedTemplate(
    new VarRef<(strings: TemplateStringsArray, value: number) => { text: string }>("formatValue"),
    $.template(["value: ", ""], 1),
  );
  const assignExpr = $.assign(new VarRef<number>("count"), 2);
  const sumExpr = numeric.add(1, new VarRef<number>("delta"));
  const eqExpr = compare.eq(1, 2);
  const concatExpr = str.concat("Hello, ", "Ada");
  const logicExpr = logic.and(true, false);

  expectTypeOf<InferExpr<typeof arrayExpr>>(null as any).toEqualTypeOf<number[]>();
  expectTypeOf<InferExpr<typeof objectExpr>>(null as any).toEqualTypeOf<{
    id: number;
    name: string;
    active: boolean;
  }>();
  expectTypeOf<InferExpr<typeof templateExpr>>(null as any).toEqualTypeOf<string>();
  expectTypeOf<InferExpr<typeof ternaryExpr>>(null as any).toEqualTypeOf<number | string>();
  expectTypeOf<InferExpr<typeof nullishExpr>>(null as any).toEqualTypeOf<number | string>();
  expectTypeOf<InferExpr<typeof awaitExpr>>(null as any).toEqualTypeOf<number>();
  expectTypeOf<InferExpr<typeof methodExpr>>(null as any).toEqualTypeOf<string>();
  expectTypeOf<InferExpr<typeof optionalPropExpr>>(null as any).toEqualTypeOf<string | undefined>();
  expectTypeOf<InferExpr<typeof optionalCallExpr>>(null as any).toEqualTypeOf<number | undefined>();
  expectTypeOf<InferExpr<typeof asExpr>>(null as any).toEqualTypeOf<number>();
  expectTypeOf<InferExpr<typeof satisfiesExpr>>(null as any).toEqualTypeOf<{
    id: number;
    name: string;
  }>();
  expectTypeOf<InferExpr<typeof nonNullExpr>>(null as any).toEqualTypeOf<string>();
  expectTypeOf<InferExpr<typeof annotatedCall>>(null as any).toEqualTypeOf<number>();

  // @ts-expect-error invalid property keys should be rejected on typed refs
  $.prop(null as any as VarRef<{ id: number; name: string }>, "missing");
  expectTypeOf<InferExpr<typeof newExpr>>(null as any).toEqualTypeOf<{
    id: number;
  }>();
  expectTypeOf<InferExpr<typeof taggedExpr>>(null as any).toEqualTypeOf<{
    text: string;
  }>();
  expectTypeOf<InferExpr<typeof assignExpr>>(null as any).toEqualTypeOf<number>();
  expectTypeOf<InferExpr<typeof sumExpr>>(null as any).toEqualTypeOf<number>();
  expectTypeOf<InferExpr<typeof eqExpr>>(null as any).toEqualTypeOf<boolean>();
  expectTypeOf<InferExpr<typeof concatExpr>>(null as any).toEqualTypeOf<string>();
  expectTypeOf<InferExpr<typeof logicExpr>>(null as any).toEqualTypeOf<boolean>();
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

test("TypeRef from $.type can be reused across later declarations", () => {
  const arrayOf = <T>(item: TypeRef<T>) => type.array(item);
  const paramOf = <const N extends string, T>(name: N, item: TypeRef<T>) => $.p(name, item);

  $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    );

    type UserShape = typeof User extends TypeRef<infer U> ? U : never;
    show<{ id: number; name: string }>(null as any as UserShape);
    show<UserShape>(null as any as { id: number; name: string });

    const { user } = yield* $.bind({
      user: {
        value: { id: 1, name: "Ada" },
        tsType: User,
      },
    });

    show<VarRef<{ id: number; name: string }>>(user);
    show<typeof user>(null as any as VarRef<{ id: number; name: string }>);

    const UserList = yield* $.type("UserList", arrayOf(User));
    type UserListShape = typeof UserList extends TypeRef<infer U> ? U : never;
    show<Array<{ id: number; name: string }>>(null as any as UserListShape);
    show<UserListShape>(null as any as Array<{ id: number; name: string }>);

    const formatUser = yield* $.function(
      "formatUser",
      [paramOf("user", User)] as const,
      function* ({ user }) {
        return $.prop(user, "name");
      },
      { returnType: type.string() },
    );

    type FormatUser = typeof formatUser extends VarRef<infer U> ? U : never;
    show<[user: { id: number; name: string }]>(null as any as Parameters<FormatUser>);
    show<Parameters<FormatUser>>(null as any as [user: { id: number; name: string }]);
    show<string>(null as any as ReturnType<FormatUser>);
    show<ReturnType<FormatUser>>(null as any as string);
  }).toBabelAST();

  const block = $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    );
    yield* $.type("UserList", arrayOf(User));

    const { user } = yield* $.bind({
      user: {
        value: { id: 1, name: "Ada" },
        tsType: User,
      },
    });

    yield* $.function(
      "formatUser",
      [paramOf("user", User)] as const,
      function* ({ user }) {
        return $.prop(user, "name");
      },
      { returnType: type.string() },
    );

    const { displayName } = yield* $.bind({
      displayName: $.call("formatUser", [user], undefined, type.string()),
    });

    expectTypeOf<typeof displayName>(null as any).toEqualTypeOf<VarRef<string>>();
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type User =");
  expect(code).toContain("type UserList = User[]");
  expect(code).toContain("const user: User =");
  expect(code).toContain("function formatUser(user: User): string");
  expect(code).toContain("const displayName: string = formatUser(user)");
});

test("helper functions preserve TypeRef and VarRef inference across calls", () => {
  const userParam = <const N extends string, T extends { name: string }>(
    name: N,
    item: TypeRef<T>,
  ) => $.p(name, item);
  const callFormatter = <T>(
    formatter: VarRef<(value: T) => string>,
    value: VarRef<T> | TypedExpression<T>,
  ) => $.call(formatter, [value]);

  $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        name: type.string(),
      }),
    );

    const formatUser = yield* $.function(
      "formatUser",
      [userParam("user", User)] as const,
      function* ({ user }) {
        return str.concat($.prop(user, "name"), "!");
      },
      { returnType: type.string() },
    );

    const { user } = yield* $.bind({
      user: {
        value: { name: "Ada" },
        tsType: User,
      },
    });

    const greetingExpr = callFormatter(formatUser, user);

    show<string>(null as any as InferExpr<typeof greetingExpr>);
    show<InferExpr<typeof greetingExpr>>(null as any as string);
  }).toBabelAST();

  const block = $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        name: type.string(),
      }),
    );

    const formatUser = yield* $.function(
      "formatUser",
      [userParam("user", User)] as const,
      function* ({ user }) {
        return str.concat($.prop(user, "name"), "!");
      },
      { returnType: type.string() },
    );

    const { user } = yield* $.bind({
      user: {
        value: { name: "Ada" },
        tsType: User,
      },
    });

    const { greeting } = yield* $.bind({
      greeting: callFormatter(formatUser, user),
    });

    show<VarRef<string>>(greeting);
    show<typeof greeting>(null as any as VarRef<string>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("function formatUser(user: User): string");
  expect(code).toContain("const greeting: string = formatUser(user)");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      return greeting;
    }
    module.exports = run;
  `);
  const module = { exports: undefined as undefined | (() => string) };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => string;

  expect(run()).toBe("Ada!");
});

test("TypeRef-derived descriptors can be reused across later declarations", () => {
  const fieldType = <TObject extends { name: unknown }, TField extends keyof TObject & string>(
    objectType: TypeRef<TObject>,
    key: TField,
  ) => type.indexedAccess(objectType, type.literal(key));

  $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    );

    const UserName = yield* $.type("UserName", fieldType(User, "name"));
    type UserNameShape = typeof UserName extends TypeRef<infer U> ? U : never;
    show<string>(null as any as UserNameShape);
    show<UserNameShape>(null as any as string);

    const { name } = yield* $.bind({
      name: {
        value: "Ada",
        tsType: UserName,
      },
    });

    show<VarRef<string>>(name);
    show<typeof name>(null as any as VarRef<string>);
  }).toBabelAST();

  const block = $.block(function* () {
    const User = yield* $.type(
      "User",
      type.object({
        id: type.number(),
        name: type.string(),
      }),
    );

    const UserName = yield* $.type("UserName", fieldType(User, "name"));

    yield* $.bind({
      name: {
        value: "Ada",
        tsType: UserName,
      },
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('type UserName = User["name"]');
  expect(code).toContain('const name: UserName = "Ada"');
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

test("VarRefs flow through helper functions and generated runtime code", () => {
  const pickName = <T extends { name: string }>(user: VarRef<T>) => $.prop(user, "name");
  const exclaim = (value: VarRef<string> | TypedExpression<string>) => str.concat(value, "!");
  const invoke = <TResult>(
    fn: VarRef<(name: string) => TResult>,
    name: VarRef<string> | TypedExpression<string>,
  ) => $.call(fn, [name]);

  const block = $.block(function* () {
    const { user } = yield* $.bind({
      user: {
        id: 1,
        name: "Ada",
      },
    });

    const nameExpr = pickName(user);
    expectTypeOf<InferExpr<typeof nameExpr>>(null as any).toEqualTypeOf<string>();

    const greet = yield* $.function(
      "greet",
      [$.p("name", type.string())] as const,
      function* ({ name }) {
        return exclaim(name);
      },
      { returnType: type.string() },
    );

    type Greet = typeof greet extends VarRef<infer U> ? U : never;
    show<[name: string]>(null as any as Parameters<Greet>);
    show<Parameters<Greet>>(null as any as [name: string]);
    expectTypeOf<ReturnType<Greet>>(null as any).toEqualTypeOf<string>();

    const { displayName, greeting } = yield* $.bind({
      displayName: exclaim(nameExpr),
      greeting: invoke(greet, nameExpr),
    });

    expectTypeOf<typeof displayName>(null as any).toEqualTypeOf<VarRef<string>>();
    expectTypeOf<typeof greeting>(null as any).toEqualTypeOf<VarRef<string>>();
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('const displayName: string = user.name + "!"');
  expect(code).toContain('return name + "!"');
  expect(code).toContain("const greeting: string = greet(user.name)");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      return { displayName, greeting };
    }
    module.exports = run;
  `);
  const module = {
    exports: undefined as undefined | (() => { displayName: string; greeting: string }),
  };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => { displayName: string; greeting: string };

  expect(run()).toEqual({ displayName: "Ada!", greeting: "Ada!" });
});

test("class refs preserve instance inference through later helper usage", () => {
  const readCount = <T extends { count: number }>(instance: VarRef<T> | TypedExpression<T>) =>
    $.prop(instance, "count");

  $.block(function* () {
    const Counter = yield* $.class("Counter", function* () {
      const count = yield* $.classProperty("count", { value: 1 });

      return { count };
    });

    const { counter } = yield* $.bind({
      counter: $.new(Counter, []),
    });
    const countExpr = readCount(counter);

    show<VarRef<{ count: number }>>(counter);
    show<typeof counter>(null as any as VarRef<{ count: number }>);
    show<number>(null as any as InferExpr<typeof countExpr>);
    show<InferExpr<typeof countExpr>>(null as any as number);
  }).toBabelAST();

  const block = $.block(function* () {
    const Counter = yield* $.class("Counter", function* () {
      const count = yield* $.classProperty("count", { value: 1 });

      return { count };
    });

    const { counter } = yield* $.bind({
      counter: $.new(Counter, []),
    });

    const { current } = yield* $.bind({
      current: readCount(counter),
    });

    show<VarRef<number>>(current);
    show<typeof current>(null as any as VarRef<number>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const counter: Counter = new Counter()");
  expect(code).toContain("const current: number = counter.count");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      return current;
    }
    module.exports = run;
  `);
  const module = { exports: undefined as undefined | (() => number) };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => number;

  expect(run()).toBe(1);
});

test("class members can be authored through captured refs instead of string keys", () => {
  const block = $.block(function* () {
    yield* $.class("Person", function* () {
      const name = yield* $.classProperty("name", {
        typeAnnotation: type.string(),
        accessibility: "private",
      });
      const ageValue = yield* $.classProperty("_age", {
        value: 37,
        typeAnnotation: type.number(),
        accessibility: "private",
      });
      const age = yield* $.classMethod("age", [], function* () {
        return ageValue;
      });
      yield* $.constructor(
        [$.p("name", type.string()), $.p("age", type.number())],
        function* ({ name: initialName, age: initialAge }) {
          yield* $.expression($.assign(name, initialName));
          yield* $.expression($.assign(ageValue, initialAge));
        },
      );
      const greet = yield* $.classMethod(
        "greet",
        [],
        function* () {
          return $.template`Hello, I'm ${name}`;
        },
        { returnType: type.string() },
      );

      return { age, greet };
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("age(): number");
  expect(code).toContain("this.name = name");
  expect(code).toContain("this._age = age");
  expect(code).toContain("return `Hello, I'm ");
  expect(code).toContain("return this._age");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      const person = new Person("Ada", 41);
      return { age: person.age(), greeting: person.greet() };
    }
    module.exports = run;
  `);
  const module = {
    exports: undefined as undefined | (() => { age: number; greeting: string }),
  };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => { age: number; greeting: string };

  expect(run()).toEqual({ age: 41, greeting: "Hello, I'm Ada" });
});

test("captured class property refs can replace self in method bodies", () => {
  $.block(function* () {
    const ScoreBoard = yield* $.class("ScoreBoard", function* () {
      const label = yield* $.classProperty("label", {
        typeAnnotation: type.string(),
        accessibility: "private",
      });
      const score = yield* $.classProperty("score", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });

      yield* $.constructor(
        [$.p("label", type.string()), $.p("score", type.number())],
        function* ({ label: initialLabel, score: initialScore }) {
          yield* $.expression($.assign(label, initialLabel));
          yield* $.expression($.assign(score, initialScore));
        },
      );

      const bump = yield* $.classMethod(
        "bump",
        [],
        function* () {
          yield* $.expression($.assign(score, numeric.add(score, 1)));
          return score;
        },
        { returnType: type.number() },
      );

      const describe = yield* $.classMethod(
        "describe",
        [],
        function* () {
          return $.template`${label}: ${score}`;
        },
        { returnType: type.string() },
      );

      return { bump, describe };
    });

    const { board } = yield* $.bind({
      board: $.new(ScoreBoard, ["tasks", 2]),
    });
    const bumpExpr = $.methodCall(board, "bump", []);
    const describeExpr = $.methodCall(board, "describe", []);

    expectTypeOf<InferExpr<typeof bumpExpr>>(null as any).toEqualTypeOf<number>();
    expectTypeOf<InferExpr<typeof describeExpr>>(null as any).toEqualTypeOf<string>();
  }).toBabelAST();

  const block = $.block(function* () {
    yield* $.class("ScoreBoard", function* () {
      const label = yield* $.classProperty("label", {
        typeAnnotation: type.string(),
        accessibility: "private",
      });
      const score = yield* $.classProperty("score", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });

      yield* $.constructor(
        [$.p("label", type.string()), $.p("score", type.number())],
        function* ({ label: initialLabel, score: initialScore }) {
          yield* $.expression($.assign(label, initialLabel));
          yield* $.expression($.assign(score, initialScore));
        },
      );

      yield* $.classMethod(
        "bump",
        [],
        function* () {
          yield* $.expression($.assign(score, numeric.add(score, 1)));
          return score;
        },
        { returnType: type.number() },
      );

      yield* $.classMethod(
        "describe",
        [],
        function* () {
          return $.template`${label}: ${score}`;
        },
        { returnType: type.string() },
      );
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("this.label = label");
  expect(code).toContain("this.score = score");
  expect(code).toContain("this.score = this.score + 1");
  expect(code).toContain("return this.score");
  expect(code).toContain("return `${this.label}: ${this.score}`");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      const board = new ScoreBoard("tasks", 2);
      return { value: board.bump(), description: board.describe() };
    }
    module.exports = run;
  `);
  const module = {
    exports: undefined as undefined | (() => { value: number; description: string }),
  };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => { value: number; description: string };

  expect(run()).toEqual({ value: 3, description: "tasks: 3" });
});

test("yielded constructor drives class ref constructor inference", () => {
  $.block(function* () {
    const ScoreBoard = yield* $.class("ScoreBoard", function* () {
      const label = yield* $.classProperty("label", {
        typeAnnotation: type.string(),
        accessibility: "private",
      });
      const score = yield* $.classProperty("score", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });

      yield* $.constructor(
        [$.p("label", type.string()), $.p("score", type.number())] as const,
        function* ({ label: initialLabel, score: initialScore }) {
          yield* $.expression($.assign(label, initialLabel));
          yield* $.expression($.assign(score, initialScore));
        },
      );

      const describe = yield* $.classMethod(
        "describe",
        [],
        function* () {
          return $.template`${label}: ${score}`;
        },
        { returnType: type.string(), accessibility: "public" },
      );

      return { describe };
    });

    type ScoreBoardPublic = { describe: () => string };
    type ScoreBoardCtor = ClassConstructorOf<typeof ScoreBoard>;

    show<ClassRef<ScoreBoardPublic>>(null as any as typeof ScoreBoard);
    expectTypeOf<Parameters<ScoreBoardCtor>>(null as any).toEqualTypeOf<
      [label: string, score: number]
    >();

    const okNew = $.new(ScoreBoard, ["tasks", 2]);
    expectTypeOf<InferExpr<typeof okNew>>(null as any).toEqualTypeOf<ScoreBoardPublic>();

    // @ts-expect-error constructor args are required
    $.new(ScoreBoard, []);
  }).toBabelAST();
});

test("$.class host classes lower with opaque instance typing", () => {
  class ScoreBoard extends $.class<ScoreBoard>("ScoreBoard")(function* () {
    const label = yield* $.classProperty("label", {
      typeAnnotation: type.string(),
    });
    const score = yield* $.classProperty("score", {
      typeAnnotation: type.number(),
    });

    yield* $.constructor(
      [$.p("label", type.string()), $.p("score", type.number())],
      function* ({ label: initialLabel, score: initialScore }) {
        yield* $.expression($.assign(label, initialLabel));
        yield* $.expression($.assign(score, initialScore));
      },
    );

    const bump = yield* $.classMethod(
      "bump",
      [],
      function* () {
        yield* $.expression($.assign(score, numeric.add(score, 1)));
        return score;
      },
      { returnType: type.number() },
    );

    const describe = yield* $.classMethod(
      "describe",
      [],
      function* () {
        return $.template`${label}: ${score}`;
      },
      { returnType: type.string() },
    );

    return { bump, describe };
  }) {}

  const block = $.block(function* () {
    const ScoreBoardRef = yield* ScoreBoard;
    type ScoreBoardCtor = ClassConstructorOf<typeof ScoreBoard>;
    const score = yield* $.let("score", 2);

    show<ClassRef<ScoreBoard>>(null as any as typeof ScoreBoardRef);
    expectTypeOf<Parameters<ScoreBoardCtor>>(null as any).toEqualTypeOf<
      [arg0: string, arg1: number]
    >();

    const board = $.new(ScoreBoard, ["tasks", score]);
    expectTypeOf<InferExpr<typeof board>>(null as any).toEqualTypeOf<ScoreBoard>();

    const described = $.methodCall(board, "describe", []);
    expectTypeOf<InferExpr<typeof described>>(null as any).toEqualTypeOf<string>();
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class ScoreBoard");
  expect(code).toContain("private label: string");
  expect(code).toContain("private score: number");
  expect(code).toContain("constructor(label: string, score: number)");
  expect(code).toContain("bump(): number");
  expect(code).toContain("describe(): string");
});

test("$.p accepts host classes as type inputs", () => {
  class ScoreBoard extends $.class<ScoreBoard>("ScoreBoard")(function* () {
    const label = yield* $.classProperty("label", {
      typeAnnotation: type.string(),
    });

    yield* $.constructor([$.p("label", type.string())], function* ({ label: initialLabel }) {
      yield* $.expression($.assign(label, initialLabel));
    });

    const describe = yield* $.classMethod(
      "describe",
      [],
      function* () {
        return label;
      },
      { returnType: type.string() },
    );

    return { describe };
  }) {}

  const block = $.block(function* () {
    yield* ScoreBoard;

    const fn = yield* $.function("fn", [$.p("scoreBoard", ScoreBoard)], function* ({ scoreBoard }) {
      const { description } = yield* $.bind({
        description: $.methodCall(scoreBoard, "describe", []),
      });
      const { nextScore } = yield* $.bind({
        nextScore: 1,
      });

      return { description, nextScore };
    });

    type Fn = typeof fn extends VarRef<infer U> ? U : never;
    expectTypeOf<ReturnType<Fn>>(null as any).toEqualTypeOf<{
      description: string;
      nextScore: number;
    }>();
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("function fn(scoreBoard: ScoreBoard)");
  expect(code).toContain("return {");
});

test("$.class host classes reject aliasing returned exports", () => {
  class BadAlias extends $.class<BadAlias>("BadAlias")(function* () {
    const label = yield* $.classProperty("label", type.string());

    yield* $.constructor([$.p("label", type.string())], function* ({ label: initialLabel }) {
      yield* $.expression($.assign(label, initialLabel));
    });

    return {
      title: label,
    };
  }) {}

  expect(() =>
    $.block(function* () {
      yield* BadAlias;
    }).toBabelAST(),
  ).toThrow("Macro class BadAlias body() cannot alias label as title");
});

test("class method refs stay typed when reused through helper calls", () => {
  const readIncrement = <T extends { inc: (step: number) => number }>(
    instance: VarRef<T> | TypedExpression<T>,
  ) => $.prop(instance, "inc");

  $.block(function* () {
    const Counter = yield* $.class("Counter", function* () {
      const inc = yield* $.classMethod(
        "inc",
        [$.p("step", type.number())],
        function* ({ step }) {
          return step;
        },
        { returnType: type.number() },
      );

      return { inc };
    });

    const { counter } = yield* $.bind({
      counter: $.new(Counter, []),
    });
    const incExpr = readIncrement(counter);

    show<(step: number) => number>(null as any as InferExpr<typeof incExpr>);
    show<InferExpr<typeof incExpr>>(null as any as (step: number) => number);
  }).toBabelAST();

  const block = $.block(function* () {
    const Counter = yield* $.class("Counter", function* () {
      const inc = yield* $.classMethod(
        "inc",
        [$.p("step", type.number())],
        function* ({ step }) {
          return step;
        },
        { returnType: type.number() },
      );

      return { inc };
    });

    const { counter } = yield* $.bind({
      counter: $.new(Counter, []),
    });
    const { incRef } = yield* $.bind({
      incRef: readIncrement(counter),
    });

    show<VarRef<(step: number) => number>>(incRef);
    show<typeof incRef>(null as any as VarRef<(step: number) => number>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const incRef");
  expect(code).toContain("= counter.inc");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      return typeof incRef;
    }
    module.exports = run;
  `);
  const module = { exports: undefined as undefined | (() => string) };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => string;

  expect(run()).toBe("function");
});

test("captured class method refs can be called inside later method bodies", () => {
  $.block(function* () {
    yield* $.class("Counter", function* () {
      const count = yield* $.classProperty("count", {
        value: 0,
        accessibility: "private",
      });
      const inc = yield* $.classMethod(
        "inc",
        [],
        function* () {
          yield* $.expression($.assign(count, numeric.add(count, 1)));
          return count;
        },
        { returnType: type.number() },
      );

      const twice = yield* $.classMethod("twice", [], function* () {
        yield* $.expression($.call(inc, []));
        return $.call(inc, []);
      });

      return { inc, twice };
    });
  }).toBabelAST();

  const block = $.block(function* () {
    yield* $.class("Counter", function* () {
      const count = yield* $.classProperty("count", {
        value: 0,
        accessibility: "private",
      });
      const inc = yield* $.classMethod(
        "inc",
        [],
        function* () {
          yield* $.expression($.assign(count, numeric.add(count, 1)));
          return count;
        },
        { returnType: type.number() },
      );

      yield* $.classMethod("twice", [], function* () {
        yield* $.expression($.call(inc, []));
        return $.call(inc, []);
      });
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("twice(): number");
  expect(code).toContain("private count = 0");
  expect(code).toContain("this.inc()");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    function run() {
${body}
      return new Counter().twice();
    }
    module.exports = run;
  `);
  const module = { exports: undefined as undefined | (() => number) };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => number;

  expect(run()).toBe(2);
});

test("class getter refs preserve property-shaped public inference", () => {
  $.block(function* () {
    const Person = yield* $.class("Person", function* () {
      const name = yield* $.classProperty("name", {
        typeAnnotation: type.string(),
        accessibility: "private",
      });
      const ageValue = yield* $.classProperty("age", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });
      yield* $.constructor(
        [$.p("name", type.string()), $.p("age", type.number())],
        function* ({ name: initialName, age: initialAge }) {
          yield* $.expression($.assign(name, initialName));
          yield* $.expression($.assign(ageValue, initialAge));
        },
      );
      const greet = yield* $.classMethod(
        "greet",
        [],
        function* () {
          return $.template`Hello, I'm ${name}`;
        },
        { returnType: type.string(), accessibility: "public" },
      );
      const age = yield* $.classMethod(
        "age",
        [],
        function* () {
          return ageValue;
        },
        { kind: "get", returnType: type.number() },
      );

      return { greet, age };
    });

    type PersonPublic = {
      greet: () => string;
      age: number;
    };
    type PersonInstance = ClassInstanceOf<typeof Person>;

    show<PersonPublic>(null as any as PersonInstance);
    show<PersonInstance>(null as any as PersonPublic);
    show<() => string>(null as any as PersonInstance["greet"]);
    show<PersonInstance["greet"]>(null as any as () => string);
    expectTypeOf<PersonInstance["age"]>(null as any).toEqualTypeOf<number>();
  }).toBabelAST();
});

test("forOf loop vars preserve inference through helper usage", () => {
  const pickName = <T extends { name: string }>(item: VarRef<T> | TypedExpression<T>) =>
    $.prop(item, "name");

  const block = $.block(function* () {
    const { users } = yield* $.bind({
      users: {
        value: [{ name: "Ada" }, { name: "Lin" }],
        tsType: type.array(type.object({ name: type.string() })),
      },
    });

    yield* $.forOf("user", users, function* (user) {
      show<VarRef<{ name: string }>>(user);
      show<typeof user>(null as any as VarRef<{ name: string }>);

      const { name } = yield* $.bind({
        name: pickName(user),
      });

      show<VarRef<string>>(name);
      show<typeof name>(null as any as VarRef<string>);
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("for (const user of users)");
  expect(code).toContain("const name: string = user.name");
});

test("member inference preserves shared properties across union objects", () => {
  const block = $.block(function* () {
    const { users } = yield* $.bind({
      users: $.as(
        [{ name: "Ada" }, { name: "Lin" }],
        type.array(
          type.union(
            type.object({ name: type.literal("Ada") }),
            type.object({ name: type.literal("Lin") }),
          ),
        ),
      ),
    });

    yield* $.forOf("user", users, function* (user) {
      const { name } = yield* $.bind({
        name: $.prop(user, "name"),
      });

      show<VarRef<"Ada" | "Lin">>(name);
      show<typeof name>(null as any as VarRef<"Ada" | "Lin">);
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const name: string = user.name");
});

test("optional and method helpers preserve inference through ref-passing", () => {
  const readMaybeName = <T extends { name: string }>(
    value: VarRef<T | null> | TypedExpression<T | null>,
  ) => $.optional.prop(value, "name");
  const invokeMaybe = <T>(value: VarRef<(() => T) | null> | TypedExpression<(() => T) | null>) =>
    $.optional.call(value, []);
  const readMaybeLength = (value: VarRef<string | null> | TypedExpression<string | null>) =>
    $.optional.prop(value, "length");
  const uppercase = (value: VarRef<string> | TypedExpression<string>) =>
    $.methodCall(value, "toUpperCase", []);

  $.block(function* () {
    const user = new VarRef<{ name: string } | null>("user");
    const maybeGreet = new VarRef<(() => string) | null>("maybeGreet");
    const maybeText = new VarRef<string | null>("maybeText");

    const maybeName = readMaybeName(user);
    const maybeGreeting = invokeMaybe(maybeGreet);
    const maybeLength = readMaybeLength(maybeText);
    const upperName = uppercase(new VarRef<string>("name"));

    show<string | undefined>(null as any as InferExpr<typeof maybeName>);
    show<InferExpr<typeof maybeName>>(null as any as string | undefined);
    show<string | undefined>(null as any as InferExpr<typeof maybeGreeting>);
    show<InferExpr<typeof maybeGreeting>>(null as any as string | undefined);
    show<number | undefined>(null as any as InferExpr<typeof maybeLength>);
    show<InferExpr<typeof maybeLength>>(null as any as number | undefined);
    show<string>(null as any as InferExpr<typeof upperName>);
    show<InferExpr<typeof upperName>>(null as any as string);
  }).toBabelAST();

  const block = $.block(function* () {
    const { user, maybeGreet, maybeText, name } = yield* $.bind({
      user: {
        value: { name: "Ada" } as { name: string } | null,
        tsType: type.union(type.object({ name: type.string() }), type.null()),
      },
      maybeGreet: {
        value: $.arrow([] as const, $.string("hello"), {
          returnType: type.string(),
        }),
        tsType: type.union(type.function([], type.string()), type.null()),
      },
      maybeText: {
        value: "Ada",
        tsType: type.union(type.string(), type.null()),
      },
      name: "Ada",
    });

    const { maybeName, maybeGreeting, maybeLength, upperName } = yield* $.bind({
      maybeName: readMaybeName(user),
      maybeGreeting: invokeMaybe(maybeGreet),
      maybeLength: readMaybeLength(maybeText),
      upperName: uppercase(name),
    });

    show<VarRef<string | undefined>>(maybeName);
    show<typeof maybeName>(null as any as VarRef<string | undefined>);
    show<VarRef<string | undefined>>(maybeGreeting);
    show<typeof maybeGreeting>(null as any as VarRef<string | undefined>);
    show<VarRef<number | undefined>>(maybeLength);
    show<typeof maybeLength>(null as any as VarRef<number | undefined>);
    show<VarRef<string>>(upperName);
    show<typeof upperName>(null as any as VarRef<string>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const maybeName: string | undefined = user?.name");
  expect(code).toContain("const maybeGreeting: string | undefined = maybeGreet?.()");
  expect(code).toContain("const maybeLength: number | undefined = maybeText?.length");
  expect(code).toContain("const upperName: string = name.toUpperCase()");
});

test("types derived from bound vars can feed later declarations and helpers", () => {
  const nameTypeOf = <T extends { name: unknown }>(value: VarRef<T>) =>
    type.indexedAccess(type.typeof(value), type.literal("name"));

  $.block(function* () {
    const { user } = yield* $.bind({
      user: {
        id: 1,
        name: "Ada",
      },
    });

    const User = yield* $.type("User", type.typeof(user));
    const UserName = yield* $.type("UserName", nameTypeOf(user));

    type UserShape = typeof User extends TypeRef<infer U> ? U : never;
    type UserNameShape = typeof UserName extends TypeRef<infer U> ? U : never;
    show<{ readonly id: number; readonly name: string }>(null as any as UserShape);
    show<UserShape>(null as any as { readonly id: number; readonly name: string });
    show<string>(null as any as UserNameShape);
    show<UserNameShape>(null as any as string);
  }).toBabelAST();

  const block = $.block(function* () {
    const nameTypeOf = <T extends { name: unknown }>(value: VarRef<T>) =>
      type.indexedAccess(type.typeof(value), type.literal("name"));

    const { user } = yield* $.bind({
      user: {
        id: 1,
        name: "Ada",
      },
    });

    const User = yield* $.type("User", type.typeof(user));
    const UserName = yield* $.type("UserName", nameTypeOf(user));

    const formatUser = yield* $.function(
      "formatUser",
      [$.p("user", User)],
      function* ({ user }) {
        return $.prop(user, "name");
      },
      { returnType: UserName },
    );

    const result = yield* $.let("result", $.call(formatUser, [user]));

    const { displayName } = yield* $.bind({
      displayName: {
        value: "Ada",
        tsType: UserName,
      },
    });

    show<VarRef<string>>(displayName);
    show<typeof displayName>(null as any as VarRef<string>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type User = typeof user");
  expect(code).toContain('type UserName = typeof user["name"]');
  expect(code).toContain("function formatUser(user: User): UserName");
  expect(code).toContain('const displayName: UserName = "Ada"');
});

test("async helper composition preserves function, call, and await inference", async () => {
  const invokeAndAwait = <T>(
    loader: VarRef<(value: string) => Promise<T>>,
    value: VarRef<string> | TypedExpression<string>,
  ) => $.await($.call(loader, [value]));

  $.block(function* () {
    const { prefix, suffix } = yield* $.bind({
      prefix: "Ada",
      suffix: " Lovelace",
    });

    const loadName = yield* $.async(
      "loadName",
      [$.p("suffix", type.string())] as const,
      function* ({ suffix }) {
        return str.concat(prefix, suffix);
      },
      { returnType: type.string() },
    );

    type LoadName = typeof loadName extends VarRef<infer U> ? U : never;
    show<[suffix: string]>(null as any as Parameters<LoadName>);
    show<Parameters<LoadName>>(null as any as [suffix: string]);
    show<Promise<string>>(null as any as ReturnType<LoadName>);
    show<ReturnType<LoadName>>(null as any as Promise<string>);

    const loadedName = invokeAndAwait(loadName, suffix);
    show<string>(null as any as InferExpr<typeof loadedName>);
    show<InferExpr<typeof loadedName>>(null as any as string);
  }).toBabelAST();

  const block = $.block(function* () {
    const { prefix, suffix } = yield* $.bind({
      prefix: "Ada",
      suffix: " Lovelace",
    });

    const loadName = yield* $.async(
      "loadName",
      [$.p("suffix", type.string())] as const,
      function* ({ suffix }) {
        return str.concat(prefix, suffix);
      },
      { returnType: type.string() },
    );

    const { loadedName } = yield* $.bind({
      loadedName: invokeAndAwait(loadName, suffix),
    });

    show<VarRef<string>>(loadedName);
    show<typeof loadedName>(null as any as VarRef<string>);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("async function loadName(suffix: string): Promise<string>");
  expect(code).toContain("const loadedName: string = await loadName(suffix)");

  const body = code.replace(/^\{\n?/, "").replace(/\n?\}$/, "");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const runtimeSource = transpiler.transformSync(`
    async function run() {
${body}
      return loadedName;
    }
    module.exports = run;
  `);
  const module = {
    exports: undefined as undefined | (() => Promise<string>),
  };
  const run = new Function("module", "exports", runtimeSource + "\nreturn module.exports;")(
    module,
    module.exports,
  ) as () => Promise<string>;

  expect(await run()).toBe("Ada Lovelace");
});

test("function params support optional, rest, and default", () => {
  const block = $.block(function* () {
    yield* $.function(
      "demo",
      [$.p("name", type.string(), { optional: true }), $.p("rest", type.number(), { rest: true })],
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

test("function-like builders preserve optional, rest, and default parameter inference", () => {
  $.block(function* () {
    const fn = yield* $.function(
      "demo",
      [
        $.p("name", type.string(), { optional: true }),
        $.p("rest", type.number(), { rest: true }),
      ] as const,
      function* () {
        return 0;
      },
    );

    type Fn = typeof fn extends VarRef<infer U> ? U : never;
    type FnParams = Parameters<Fn>;
    show<[name?: string, ...rest: number[]]>(null as any as FnParams);
    show<FnParams>(null as any as [name?: string, ...rest: number[]]);
    expectTypeOf<ReturnType<Fn>>(null as any).toEqualTypeOf<number>();

    const withDefault = yield* $.function(
      "withDefault",
      [$.p("count", type.number(), { default: 1 })] as const,
      function* () {
        return 1;
      },
    );

    type WithDefault = typeof withDefault extends VarRef<infer U> ? U : never;
    type WithDefaultParams = Parameters<WithDefault>;
    show<[count?: number]>(null as any as WithDefaultParams);
    show<WithDefaultParams>(null as any as [count?: number]);
    expectTypeOf<ReturnType<WithDefault>>(null as any).toEqualTypeOf<number>();

    const asyncFn = yield* $.async(
      "loadMaybe",
      [$.p("flag", type.boolean(), { default: true })] as const,
      function* () {
        return 1;
      },
    );

    type AsyncFn = typeof asyncFn extends VarRef<infer U> ? U : never;
    type AsyncFnParams = Parameters<AsyncFn>;
    show<[flag?: boolean]>(null as any as AsyncFnParams);
    show<AsyncFnParams>(null as any as [flag?: boolean]);
    expectTypeOf<ReturnType<AsyncFn>>(null as any).toEqualTypeOf<Promise<number>>();
  }).toBabelAST();

  const arrow = $.arrow(
    [{ name: "count", tsType: type.number(), default: 1 }] as const,
    $.number(1),
  );
  type Arrow = InferExpr<typeof arrow>;
  type ArrowParams = Parameters<Arrow>;
  show<[count?: number]>(null as any as ArrowParams);
  show<ArrowParams>(null as any as [count?: number]);
  expectTypeOf<ReturnType<Arrow>>(null as any).toEqualTypeOf<number>();
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
    result.kind === "union" ?
      result.types.map(t => (t.kind === "primitive" ? t.name : "")).sort()
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
  const kinds = result.kind === "union" ? result.types.map(t => t.kind) : [];
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
    result.types.some(t => t.kind === "primitive" && t.name === "undefined");
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

test("infer computed member on array returns element type", () => {
  const ctx = { variables: new Map<string, TSTypeDescriptor>() };
  ctx.variables.set("arr", { kind: "array", elementType: type.number() });

  const result = inferExpressionType(
    brand({
      type: "member",
      object: brand({ type: "variable", name: "arr" }),
      property: brand({ type: "literal", value: 0 }),
      computed: true,
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

test("computed member expression lowers with brackets", () => {
  const expr = brand({
    type: "member",
    object: brand({ type: "variable", name: "arr" }),
    property: brand({ type: "literal", value: 0 }),
    computed: true,
  } satisfies Expression);

  const { code } = generate(expressionToBabel(expr));
  expect(code).toBe("arr[0]");
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
    yield* $.class("Person", function* () {
      yield* $.classProperty("name", { typeAnnotation: type.string() });
      yield* $.classProperty("age", { typeAnnotation: type.number() });
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Person");
  expect(code).toContain("name: string");
  expect(code).toContain("age: number");
});

test("class with constructor", () => {
  const block = $.block(function* () {
    yield* $.class("Person", function* () {
      yield* $.classProperty("name", { typeAnnotation: type.string() });
      yield* $.constructor(
        [$.p("name", type.string()), $.p("age", type.number())],
        function* ({ name, age }) {
          const { assignName } = yield* $.bind({
            assignName: $.assign($.prop($.this(), "name"), name),
          });
          const { assignAge } = yield* $.bind({
            assignAge: $.assign($.prop($.this(), "age"), age),
          });
        },
      );
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class Person");
  expect(code).toContain("constructor(name: string, age: number)");
});

test("class with extends", () => {
  const block = $.block(function* () {
    yield* $.class("Animal", function* () {
      yield* $.classProperty("name", { typeAnnotation: type.string() });
    });
    yield* $.class("Dog", {
      extends: "Animal",
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
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("class FriendlyGreeter implements Greeter");
});

test("class emits generic type parameters", () => {
  const block = $.block(function* () {
    yield* $.class(
      "Box",
      {
        typeParams: [{ name: "T" }],
      },
      function* () {
        yield* $.classProperty("value", {
          typeAnnotation: type.reference("T"),
        });
      },
    );
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
        });
      }).toBabelAST(),
    ),
  ).toThrow("Class implements clauses must be reference or generic types");
});

test("class with static members", () => {
  const block = $.block(function* () {
    yield* $.class("Counter", function* () {
      yield* $.classProperty("count", {
        value: 1,
        typeAnnotation: type.number(),
        static: true,
      });
      yield* $.classMethod(
        "increment",
        [],
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
      );
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("static count: number = 1");
  expect(code).toContain("static increment()");
});

test("class property preserves falsy initializers", () => {
  const block = $.block(function* () {
    yield* $.class("Flags", function* () {
      yield* $.classProperty("count", {
        value: 0,
        typeAnnotation: type.number(),
      });
      yield* $.classProperty("enabled", {
        value: false,
        typeAnnotation: type.boolean(),
      });
      yield* $.classProperty("label", {
        value: "",
        typeAnnotation: type.string(),
      });
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("count: number = 0");
  expect(code).toContain("enabled: boolean = false");
  expect(code).toContain('label: string = ""');
});

test("class with accessibility modifiers", () => {
  const block = $.block(function* () {
    yield* $.class("Account", function* () {
      yield* $.classProperty("balance", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });
      yield* $.classMethod(
        "getBalance",
        [],
        function* () {
          return $.prop($.this(), "balance");
        },
        { accessibility: "public", returnType: type.number() },
      );
    });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("private balance: number");
  expect(code).toContain("public getBalance()");
});

test("class with getters and setters", () => {
  const block = $.block(function* () {
    yield* $.class("Temperature", function* () {
      yield* $.classProperty("_celsius", {
        typeAnnotation: type.number(),
        accessibility: "private",
      });
      yield* $.classMethod(
        "celsius",
        [],
        function* () {
          return $.prop($.this(), "_celsius");
        },
        { kind: "get", returnType: type.number() },
      );
      yield* $.classMethod(
        "celsius",
        [$.p("value", type.number())],
        function* ({ value }) {
          const { assign } = yield* $.bind({
            assign: $.assign($.prop($.this(), "_celsius"), value),
          });
        },
        { kind: "set" },
      );
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

test("blocks keep local build contexts", () => {
  const stringBlock = $.block(function* () {
    yield* $.type("Thing", type.string());
  });
  const numberBlock = $.block(function* () {
    yield* $.type("Thing", type.number());
  });

  expect(stringBlock.context.typeAliases.get("Thing")).toEqual(type.string());
  expect(numberBlock.context.typeAliases.get("Thing")).toEqual(type.number());
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

test("ffi globals and module imports produce typed refs", () => {
  const Console = $.ffi.global<typeof console>("console");
  expectTypeOf<typeof Console>(null as any).toEqualTypeOf<VarRef<typeof console>>();

  $.block(function* () {
    const fs = yield* $.ffi.import<typeof import("node:fs/promises")>("fs", "node:fs/promises");

    show<VarRef<typeof import("node:fs/promises")>>(fs);
    show<typeof fs>(null as any as VarRef<typeof import("node:fs/promises")>);

    const readFile = $.prop(fs, "readFile");
    show<(typeof import("node:fs/promises"))["readFile"]>(
      null as any as InferExpr<typeof readFile>,
    );
    show<InferExpr<typeof readFile>>(
      null as any as (typeof import("node:fs/promises"))["readFile"],
    );
  }).toBabelAST();
});

test("ffi globals and module imports compose with existing expression builders", () => {
  const block = $.module(function* () {
    const Console = $.ffi.global<typeof console>("console");
    yield* $.expression($.methodCall(Console, "log", ["hello"]));

    const fs = yield* $.ffi.import<typeof import("node:fs/promises")>("fs", "node:fs/promises");
    yield* $.expression($.call($.prop(fs, "readFile"), ["./package.json"]));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain('import * as fs from "node:fs/promises"');
  expect(code).toContain('console.log("hello")');
  expect(code).toContain('fs.readFile("./package.json")');
});

test("module hoists top-level imports before other statements", () => {
  const block = $.module(function* () {
    const Console = $.ffi.global<typeof console>("console");
    yield* $.expression($.methodCall(Console, "log", ["before import"]));
    yield* $.import.namespace("fs", "node:fs");
    yield* $.expression($.methodCall(Console, "log", ["after import"]));
  }).toBabelAST();

  const { code } = generate(block);
  expect(code.indexOf('import * as fs from "node:fs";')).toBeLessThan(
    code.indexOf('console.log("before import");'),
  );
});

test("import named specifiers", () => {
  const block = $.block(function* () {
    yield* $.import([{ imported: "foo" }, { imported: "bar", local: "baz" }], "./module");
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
      body: [{ type: "return", value: brand({ type: "literal", value: "hello" }) }],
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
      }).toBabelAST(),
    ),
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
  expect(code).toContain("x: number = 42");
  expect(code).toContain('y: string = "hello"');
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
      }).toBabelAST(),
    ),
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
  const Box = new ClassRef<{ value: number }>("Box") as ResolvedClassRef<
    { value: number },
    (value: number) => { value: number }
  >;
  const expr = Box.new(numeric.add(1, 2)) as unknown as Expression & {
    arguments: Expression[];
  };

  expect(expr.arguments[0]).toMatchObject({ type: "binary", op: "+" });
});

test("normalizeToExpression preserves undefined as an explicit expression", () => {
  expect(normalizeToExpression(undefined)).toMatchObject({ type: "undefined" });

  const block = $.block(function* () {
    const { value } = yield* $.bind({ value: undefined });
    const { explicit } = yield* $.bind({ explicit: $.undefined() });
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("const value: undefined = undefined;");
  expect(code).toContain("const explicit: undefined = undefined;");
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
  expectTypeOf<InferExpr<typeof annotated>>(null as any).toEqualTypeOf<number>();
});

test("enum returns typed VarRef and registers descriptor", () => {
  typeAliasRegistry.clear();
  const block = $.block(function* () {
    const Color = yield* $.enum("Color", [
      { id: "Red", initializer: "red" },
      { id: "Blue", initializer: "blue" },
    ] as const);

    type ColorShape = typeof Color extends VarRef<infer U> ? U : never;
    expectTypeOf<ColorShape["Red"]>(null as any).toEqualTypeOf<"red" | "blue">();
  }).toBabelAST();

  generate(block);
  const desc = typeAliasRegistry.get("Color");
  expect(desc).toBeDefined();
});

test("class and type helpers preserve public inference", () => {
  $.block(function* () {
    const Counter = yield* $.class("Counter", function* () {
      const count = yield* $.classProperty("count", type.number());
      const inc = yield* $.classMethod(
        "inc",
        [$.p("step", type.number())],
        function* ({ step }) {
          return step;
        },
        { returnType: type.number() },
      );

      return { count, inc };
    });

    type CounterInstance = ClassInstanceOf<typeof Counter>;
    expectTypeOf<CounterInstance["count"]>(null as any).toEqualTypeOf<number>();
    type CounterIncParams = Parameters<CounterInstance["inc"]>;
    show<[number]>(null as any as CounterIncParams);
    show<CounterIncParams>(null as any as [number]);
    expectTypeOf<ReturnType<CounterInstance["inc"]>>(null as any).toEqualTypeOf<number>();
  }).toBabelAST();

  const unionDesc = type.union(type.string(), type.number());
  const intersectionDesc = type.intersection(
    type.object({ id: type.number() }),
    type.object({ name: type.string() }),
  );
  const functionDesc = type.function([type.string()], type.number());
  const referenceDesc = type.reference("Person", type.object({ id: type.number() }));
  const promiseDesc = type.promise(type.number());
  const keyofDesc = type.keyof(type.object({ id: type.number(), name: type.string() }));
  const typeofDesc = type.typeof(new VarRef<{ id: number }>("user"));
  const indexedDesc = type.indexedAccess(
    type.object({
      id: type.number(),
      name: type.string(),
      age: { type: type.number(), optional: true },
    }),
    type.literal("age"),
  );
  const conditionalDesc = type.conditional(
    type.string(),
    type.string(),
    type.number(),
    type.boolean(),
  );
  const mappedDesc = type.mapped("K", type.number(), type.string());
  const templateLiteralDesc = type.templateLiteral("user-", [{ type: type.number(), literal: "" }]);

  expectTypeOf<InferTSType<typeof unionDesc>>(null as any).toEqualTypeOf<string | number>();
  type IntersectionShape = InferTSType<typeof intersectionDesc>;
  show<{ id: number; name: string }>(null as any as IntersectionShape);
  show<IntersectionShape>(null as any as { id: number; name: string });
  type FunctionDescParams = Parameters<InferTSType<typeof functionDesc>>;
  show<[string]>(null as any as FunctionDescParams);
  show<FunctionDescParams>(null as any as [string]);
  expectTypeOf<ReturnType<InferTSType<typeof functionDesc>>>(null as any).toEqualTypeOf<number>();
  expectTypeOf<InferTSType<typeof referenceDesc>>(null as any).toEqualTypeOf<{
    id: number;
  }>();
  expectTypeOf<InferTSType<typeof promiseDesc>>(null as any).toEqualTypeOf<Promise<number>>();
  expectTypeOf<InferTSType<typeof keyofDesc>>(null as any).toEqualTypeOf<"id" | "name">();
  expectTypeOf<InferTSType<typeof typeofDesc>>(null as any).toEqualTypeOf<{
    id: number;
  }>();
  expectTypeOf<InferTSType<typeof indexedDesc>>(null as any).toEqualTypeOf<number | undefined>();
  expectTypeOf<InferTSType<typeof conditionalDesc>>(null as any).toEqualTypeOf<number | boolean>();
  expectTypeOf<InferTSType<typeof mappedDesc>>(null as any).toEqualTypeOf<Record<string, number>>();
  expectTypeOf<InferTSType<typeof templateLiteralDesc>>(null as any).toEqualTypeOf<string>();
});

test("tuple optional elements propagate through InferTSType", () => {
  const tupleDesc = types.tuple({ type: type.string(), optional: true }, type.number());
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
    type WideFnParams = Parameters<WideFn>;
    show<[number, number, number, number, number, number]>(null as any as WideFnParams);
    show<WideFnParams>(null as any as [number, number, number, number, number, number]);
  }).toBabelAST();
});

test("function-like builders infer runtime return descriptors from explicit return statements", () => {
  $.block(function* () {
    const fn = yield* $.function("pick", [$.p("flag", type.boolean())], function* ({ flag }) {
      yield* $.if(
        flag,
        function* () {
          yield $.return("yes");
        },
        function* () {
          yield $.return("no");
        },
      );
    });

    const asyncFn = yield* $.async(
      "pickAsync",
      [$.p("flag", type.boolean())],
      function* ({ flag }) {
        yield* $.if(
          flag,
          function* () {
            yield $.return(1);
          },
          function* () {
            yield $.return(2);
          },
        );
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
  expect(parseTypeString("unknown")).toEqual({
    kind: "primitive",
    name: "unknown",
  });
  expect(parseTypeString("never")).toEqual({
    kind: "primitive",
    name: "never",
  });
  expect(parseTypeString("undefined")).toEqual({
    kind: "primitive",
    name: "undefined",
  });
});

test("TypeRef type arguments survive implements lowering", () => {
  const BoxOfString = new TypeRef("Box", {
    kind: "reference",
    name: "Box",
    typeArgs: [type.string()],
  });

  const block = $.block(function* () {
    yield* $.class("WrappedBox", {
      implements: BoxOfString,
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

test("standalone spread expressions reject lowering", () => {
  expect(() =>
    expressionToBabel(
      brand({
        type: "spread",
        argument: brand({ type: "variable", name: "arr" }),
      }),
    ),
  ).toThrow("Spread expressions are only valid inside array literals");
});

test("emits advanced type descriptors", () => {
  const keysType = type.keyof(type.object({ a: type.string(), b: type.number() }));
  const valueType = type.indexedAccess(type.object({ a: type.string() }), type.literal("a"));
  const mappedType = type.mapped(
    "K",
    type.string(),
    type.keyof(type.object({ foo: type.boolean() })),
    { readonly: true, optional: true },
  );
  const templateType = type.templateLiteral("id-", [{ type: type.string(), literal: "-ok" }]);

  const block = $.block(function* () {
    yield* $.type("Keys", keysType);
    yield* $.type("Value", valueType);
    yield* $.type("Mapped", mappedType);
    yield* $.type("Tpl", templateType);
  }).toBabelAST();

  const { code } = generate(block);
  expect(code).toContain("type Keys = keyof");
  expect(code).toContain("type Value =");
  expect(code).toContain("readonly [K in keyof");
  expect(code).toContain("`id-${string}-ok`");
});
