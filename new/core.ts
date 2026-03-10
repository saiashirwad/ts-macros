import { inspect } from "node:util";
import { Class as PipeableClass, makePipeable } from "./pipeable";
import type { Pipeable } from "./pipeable";

declare const exprTypeId: unique symbol;
declare const typeExprTypeId: unique symbol;

export interface Expr<A = unknown> extends Pipeable {
  readonly [exprTypeId]?: A;
}

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [typeExprTypeId]?: A;
}

export interface LetTransform<A = unknown> {
  <B>(builder: LetBuilder<B>): LetBuilder<B & A>;
}

export interface Param<Name extends string = string, A = unknown> {
  readonly _tag: "param";
  readonly name: Name;
  readonly type: TypeExpr<A>;
}

export type ParamBindings<Params extends readonly Param<string, any>[]> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A>
    ? VarRef<A>
    : never;
};

export type ParamExprs<Params extends readonly Param<string, any>[]> = {
  readonly [K in keyof Params]: Params[K] extends Param<any, infer A> ? Expr<A> : never;
};

export interface FunctionRef<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> extends Expr<(...args: ParamExprs<Params>) => Return> {
  readonly _tag: "function-ref";
  readonly name: string;
}

export interface CallExpr<A = unknown> extends Expr<A> {
  readonly _tag: "call-expr";
  readonly callee: FunctionRef<any, A>;
  readonly args: ReadonlyArray<Expr<any>>;
}

export interface VarRef<A = unknown> extends Expr<A> {
  readonly _tag: "var-ref";
  readonly name: string;
}

export interface NumberLiteral extends Expr<number> {
  readonly _tag: "number-literal";
  readonly value: number;
}

export interface NumberType extends TypeExpr<number> {
  readonly _tag: "number-type";
}

export interface LetDecl {
  readonly _tag: "let-decl";
  readonly name: string;
  readonly init?: Expr<any>;
  readonly annotation?: TypeExpr<any>;
}

export interface FunctionDecl<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> {
  readonly _tag: "function-decl";
  readonly name: string;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

export interface LetSpec {
  readonly name: string;
  readonly init?: Expr<any>;
  readonly annotation?: TypeExpr<any>;
}

export type FunctionImpl<Params extends readonly Param<string, any>[], Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Declaration, Expr<Return>, unknown>;

export interface FunctionSpec<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> {
  readonly name: string;
  readonly params: Params;
  readonly returnType?: TypeExpr<Return>;
  readonly impl?: FunctionImpl<Params, Return>;
}

export type Declaration = LetDecl | FunctionDecl;

export interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>;
  readonly result: A;
}

export class LetBuilder<A = unknown> extends PipeableClass() {
  constructor(readonly spec: LetSpec) {
    super();
  }

  withSpec<B>(spec: LetSpec): LetBuilder<B> {
    return new LetBuilder(spec);
  }

  *[Symbol.iterator](): Generator<LetDecl, VarRef<A>, unknown> {
    yield {
      _tag: "let-decl",
      name: this.spec.name,
      init: this.spec.init,
      annotation: this.spec.annotation,
    };

    return makePipeable({
      _tag: "var-ref",
      name: this.spec.name,
    }) as VarRef<A>;
  }
}

export class FunctionBuilder<
  Params extends readonly Param<string, any>[] = readonly [],
  Return = unknown,
> extends PipeableClass() {
  constructor(readonly spec: FunctionSpec<Params, Return>) {
    super();
  }

  withSpec<NextParams extends readonly Param<string, any>[], NextReturn>(
    spec: FunctionSpec<NextParams, NextReturn>,
  ): FunctionBuilder<NextParams, NextReturn> {
    return new FunctionBuilder(spec);
  }

  *[Symbol.iterator](): Generator<Declaration, FunctionRef<Params, Return>, unknown> {
    yield {
      _tag: "function-decl",
      name: this.spec.name,
      params: this.spec.params,
      returnType: this.spec.returnType,
      impl: this.spec.impl,
    };

    return makePipeable({
      _tag: "function-ref",
      name: this.spec.name,
    }) as FunctionRef<Params, Return>;
  }
}

export const type = {
  number(): NumberType {
    return makePipeable({
      _tag: "number-type",
    }) as NumberType;
  },
};

export const $ = {
  let(name: string): LetBuilder<unknown> {
    return new LetBuilder({ name });
  },

  function(name: string): FunctionBuilder {
    return new FunctionBuilder({
      name,
      params: [],
    });
  },

  p<const Name extends string, A>(name: Name, annotation: TypeExpr<A>): Param<Name, A> {
    return {
      _tag: "param",
      name,
      type: annotation,
    };
  },

  init<A>(expr: Expr<A>): LetTransform<A> {
    return <B>(builder: LetBuilder<B>) =>
      builder.withSpec<B & A>({
        ...builder.spec,
        init: expr,
      });
  },

  annotate<A>(annotation: TypeExpr<A>): LetTransform<A> {
    return <B>(builder: LetBuilder<B>) =>
      builder.withSpec<B & A>({
        ...builder.spec,
        annotation,
      });
  },

  params<const Params extends readonly Param<string, any>[]>(...params: Params) {
    return <Return>(
      builder: FunctionBuilder<readonly Param<string, any>[], Return>,
    ): FunctionBuilder<Params, Return> =>
      builder.withSpec<Params, Return>({
        ...builder.spec,
        params,
      });
  },

  returns<Return>(returnType: TypeExpr<Return>) {
    return <Params extends readonly Param<string, any>[]>(
      builder: FunctionBuilder<Params, any>,
    ): FunctionBuilder<Params, Return> =>
      builder.withSpec<Params, Return>(
        {
          ...builder.spec,
          returnType,
        } as FunctionSpec<Params, Return>,
      );
  },

  impl<Params extends readonly Param<string, any>[], Return>(
    impl: FunctionImpl<Params, Return>,
  ) {
    return (builder: FunctionBuilder<Params, Return>): FunctionBuilder<Params, Return> =>
      builder.withSpec<Params, Return>({
        ...builder.spec,
        impl,
      });
  },

  number(value: number): NumberLiteral {
    return makePipeable({
      _tag: "number-literal",
      value,
    }) as NumberLiteral;
  },

  call<Params extends readonly Param<string, any>[], Return>(
    callee: FunctionRef<Params, Return>,
    args: ParamExprs<Params>,
  ): CallExpr<Return> {
    return makePipeable({
      _tag: "call-expr",
      callee,
      args,
    }) as CallExpr<Return>;
  },
};

export function runMacro<A>(factory: () => Generator<Declaration, A, unknown>): Program<A> {
  const iterator = factory();
  const declarations: Declaration[] = [];

  while (true) {
    const next = iterator.next();

    console.log(
      inspect(
        {
          declarations,
          result: next.value,
        },
        {
          depth: null,
          colors: true,
        },
      ),
    );

    if (next.done) {
      return {
        declarations,
        result: next.value,
      };
    }

    declarations.push(next.value);
  }
}
