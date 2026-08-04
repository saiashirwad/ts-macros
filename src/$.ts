export { annotate, init, let_ as let, LetBuilder } from "./declarations/let.ts"
export {
  call,
  function_ as function,
  FunctionBuilder,
  impl,
  instantiate,
  p,
  params,
  returns,
} from "./declarations/function.ts"
export { object, type ObjectExpr } from "./expressions/object.ts"
export { typeParams } from "./generics/type-params.ts"
export { body, type_ as type, TypeBuilder } from "./declarations/type.ts"
export { numberLiteral as number } from "./primitives/number.ts"
export { stringLiteral as string } from "./primitives/string.ts"
