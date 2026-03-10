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

export interface LetSpec {
  readonly name: string;
  readonly init?: Expr<any>;
  readonly annotation?: TypeExpr<any>;
}

export interface Program<A> {
  readonly declarations: ReadonlyArray<LetDecl>;
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

  number(value: number): NumberLiteral {
    return makePipeable({
      _tag: "number-literal",
      value,
    }) as NumberLiteral;
  },
};

export function runMacro<A>(factory: () => Generator<LetDecl, A, unknown>): Program<A> {
  const iterator = factory();
  const declarations: LetDecl[] = [];

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
