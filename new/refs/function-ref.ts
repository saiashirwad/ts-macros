import type { Expr } from "../foundation/expr";
import type { Param, ParamExprs } from "../functions/params";
import { makePipeable } from "../pipeable";

export interface FunctionRef<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> extends Expr<(...args: ParamExprs<Params>) => Return> {
  readonly _tag: "function-ref";
  readonly name: string;
}

export const makeFunctionRef = <Params extends readonly Param<string, any>[], Return>(
  name: string,
): FunctionRef<Params, Return> =>
  makePipeable({
    _tag: "function-ref",
    name,
  }) as FunctionRef<Params, Return>;
