import { Decl, Expr, FFI, Program, Type } from "../src/index.ts"

const repro = () => {
  const bad = Expr.arrow({
    returns: Type.string,
    body: function*() {
      return 1
    },
  })
  const candidate = Math.random() < 2 ? bad : {}
  Program.build(function*() {
    // @ts-expect-error common-supertype inference cannot turn a failure into a value
    return yield* Decl.const_("actual", candidate)
  })
  // @ts-expect-error erased failure is also forbidden in call arguments
  Expr.call(FFI.Value<(x: {}) => void>("consume"), candidate)
  const args = [bad, {}]
  // @ts-expect-error array best-common-type inference cannot hide failures
  Expr.call(FFI.Value<(...x: {}[]) => void>("consume"), ...args)
}
void repro
