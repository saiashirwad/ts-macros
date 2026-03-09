// Standalone experiment for a "real host class + *impl()" authoring model.
// This intentionally does not import or reuse the project's actual DSL.

const expectType = <T>(_value: T): void => {};

type Primitive = string | number | boolean;

class CodeRef<T = unknown> {
  constructor(readonly code: string) {}

  toString(): string {
    return this.code;
  }
}

class Expr<T> extends CodeRef<T> {
  call<K extends MethodKeys<T>>(
    name: K,
    ...args: ParamsFor<T[K]>
  ): Expr<ReturnType<Extract<T[K], (...args: any[]) => any>>> {
    const renderedArgs = args.map(arg => render(arg)).join(", ");
    return new Expr(`${this.code}.${name}(${renderedArgs})`);
  }
}

class PropertyRef<T> extends CodeRef<T> {}

class MethodRef<T> extends CodeRef<T> {}

type RenderInput<T = unknown> = CodeRef<T> | (T extends Primitive ? T : never);

type MethodKeys<T> = {
  [K in keyof T]-?: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T] &
  string;

type ParamsFor<T> =
  T extends (...args: infer A) => any ? { [K in keyof A]: RenderInput<A[K]> } : never;

type BodyStmt = {
  code: string;
};

type BodyGenerator<Return extends RenderInput<any> | void = RenderInput<any> | void> = Generator<
  BodyStmt,
  Return,
  unknown
>;

type GeneratorReturn<G> = G extends Generator<any, infer Return, unknown> ? Return : never;

type ValueFromRender<T> =
  T extends CodeRef<infer Value> ? Value
  : T extends Primitive ? T
  : T extends void ? void
  : never;

type Param<T> = {
  name: string;
  tsType: string;
  ref: CodeRef<T>;
};

type ParamMap = Record<string, Param<any>>;

type ParamRefs<P extends ParamMap> = {
  [K in keyof P]: P[K] extends Param<infer T> ? CodeRef<T> : never;
};

type PropertyMember = {
  kind: "property";
  name: string;
  tsType: string;
};

type ConstructorMember = {
  kind: "constructor";
  params: string[];
  body: string[];
};

type MethodMember = {
  kind: "method";
  name: string;
  params: string[];
  returnType?: string;
  body: string[];
};

type ClassMember = PropertyMember | ConstructorMember | MethodMember;

const render = (value: RenderInput<any>): string => {
  if (value instanceof CodeRef) return value.code;
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
};

const bindParams = <P extends ParamMap>(params: P): ParamRefs<P> =>
  Object.fromEntries(
    Object.entries(params).map(([name, param]) => [name, param.ref]),
  ) as ParamRefs<P>;

const collectBody = <Return extends RenderInput<any> | void>(
  body: BodyGenerator<Return>,
): string[] => {
  const lines: string[] = [];
  let step = body.next();

  while (!step.done) {
    lines.push(step.value.code);
    step = body.next();
  }

  if (step.value !== undefined) {
    lines.push(`return ${render(step.value)};`);
  }

  return lines;
};

const renderMember = (member: ClassMember): string[] => {
  if (member.kind === "property") {
    return [`${member.name}: ${member.tsType};`];
  }

  if (member.kind === "constructor") {
    return [
      `constructor(${member.params.join(", ")}) {`,
      ...member.body.map(line => `  ${line}`),
      `}`,
    ];
  }

  return [
    `${member.name}(${member.params.join(", ")}): ${member.returnType ?? "unknown"} {`,
    ...member.body.map(line => `  ${line}`),
    `}`,
  ];
};

const renderClass = (name: string, members: ClassMember[]): string => {
  const lines = [`class ${name} {`];

  for (const member of members) {
    for (const line of renderMember(member)) {
      lines.push(`  ${line}`);
    }
  }

  lines.push(`}`);
  return lines.join("\n");
};

const escapeTemplateChunk = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");

const $ = {
  param<T>(name: string, tsType: string): Param<T> {
    return {
      name,
      tsType,
      ref: new CodeRef<T>(name),
    };
  },

  *classProperty<T>(name: string, tsType: string): Generator<ClassMember, PropertyRef<T>, unknown> {
    yield {
      kind: "property",
      name,
      tsType,
    };
    return new PropertyRef<T>(`this.${name}`);
  },

  *constructor<P extends ParamMap>(
    params: P,
    body: (args: ParamRefs<P>) => BodyGenerator<void>,
  ): Generator<ClassMember, void, unknown> {
    const refs = bindParams(params);
    yield {
      kind: "constructor",
      params: Object.values(params).map(param => `${param.name}: ${param.tsType}`),
      body: collectBody(body(refs)),
    };
  },

  *classMethod<P extends ParamMap, G extends BodyGenerator<RenderInput<any> | void>>(
    name: string,
    params: P,
    body: (args: ParamRefs<P>) => G,
    options?: { returnType?: string },
  ): Generator<
    ClassMember,
    MethodRef<(...args: any[]) => ValueFromRender<GeneratorReturn<G>>>,
    unknown
  > {
    const refs = bindParams(params);
    yield {
      kind: "method",
      name,
      params: Object.values(params).map(param => `${param.name}: ${param.tsType}`),
      returnType: options?.returnType,
      body: collectBody(body(refs)),
    };
    return new MethodRef<(...args: any[]) => ValueFromRender<GeneratorReturn<G>>>(`this.${name}`);
  },

  stmt(code: string | CodeRef<any>): BodyStmt {
    const raw = code instanceof CodeRef ? code.code : code;
    const trimmed = raw.trimEnd();
    return {
      code: trimmed.endsWith(";") ? trimmed : `${trimmed};`,
    };
  },

  assign<T>(left: RenderInput<T>, right: RenderInput<T>): string {
    return `${render(left)} = ${render(right)}`;
  },

  add(left: RenderInput<number>, right: RenderInput<number>): Expr<number> {
    return new Expr(`${render(left)} + ${render(right)}`);
  },

  template(strings: TemplateStringsArray, ...values: RenderInput<any>[]): Expr<string> {
    let code = "`";

    for (let index = 0; index < strings.length; index += 1) {
      code += escapeTemplateChunk(strings[index] ?? "");
      if (index < values.length) {
        code += `\${${render(values[index])}}`;
      }
    }

    code += "`";
    return new Expr(code);
  },
};

abstract class SomeMagicalType {}

type PublicRefs = Record<string, CodeRef<any>>;

type PublicFromRefs<T extends PublicRefs> = {
  [K in keyof T]: T[K] extends CodeRef<infer Value> ? Value : never;
};

type HostConstructor = abstract new (...args: any[]) => SomeMagicalType;

class MagicalClass<C extends HostConstructor, Public extends PublicRefs> {
  constructor(
    readonly host: C & { name: string },
    readonly members: ClassMember[],
  ) {}

  new(...args: ConstructorParameters<C>): Expr<InstanceType<C> & PublicFromRefs<Public>> {
    const renderedArgs = args.map(arg => render(arg as RenderInput<any>)).join(", ");
    return new Expr<InstanceType<C> & PublicFromRefs<Public>>(
      `new ${this.host.name}(${renderedArgs})`,
    );
  }

  render(): string {
    return renderClass(this.host.name, this.members);
  }
}

const materialize = <C extends HostConstructor, Public extends PublicRefs>(
  host: C & {
    impl(): Generator<ClassMember, Public, unknown>;
    name: string;
  },
): MagicalClass<C, Public> => {
  const members: ClassMember[] = [];

  for (const member of host.impl()) {
    members.push(member);
  }

  return new MagicalClass(host, members);
};

class ScoreBoard extends SomeMagicalType {
  declare private readonly __scoreBoardBrand: void;

  constructor(_label: string, _score: number) {
    super();
  }

  static *impl() {
    const label = yield* $.classProperty<string>("label", "string");
    const score = yield* $.classProperty<number>("score", "number");

    yield* $.constructor(
      {
        label: $.param<string>("label", "string"),
        score: $.param<number>("score", "number"),
      },
      function* ({ label: initialLabel, score: initialScore }) {
        yield $.stmt($.assign(label, initialLabel));
        yield $.stmt($.assign(score, initialScore));
      },
    );

    const bump = yield* $.classMethod(
      "bump",
      {},
      function* (): BodyGenerator<PropertyRef<number>> {
        yield $.stmt($.assign(score, $.add(score, 1)));
        return score;
      },
      { returnType: "number" },
    );

    const describe = yield* $.classMethod(
      "describe",
      {},
      function* (): BodyGenerator<Expr<string>> {
        return $.template`${label}: ${score}`;
      },
      { returnType: "string" },
    );

    return { bump, describe };
  }
}

const scoreBoardClass = materialize(ScoreBoard);
const board = scoreBoardClass.new("tasks", 2);
const description = board.call("describe");

expectType<Expr<ScoreBoard & { bump: () => number; describe: () => string }>>(board);
expectType<Expr<string>>(description);

// @ts-expect-error wrong constructor argument order
scoreBoardClass.new(2, "tasks");

// @ts-expect-error no such method on the generated public surface
board.call("missing");

console.log(scoreBoardClass.render());
console.log("");
console.log(`construction: ${board.code}`);
console.log(`method call: ${description.code}`);
