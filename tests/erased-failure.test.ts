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

  const nullish = bad ?? {}
  Program.build(function*() {
    // @ts-expect-error nullish fallback leaves an erased object type, not a valid value
    return yield* Decl.const_("actual", nullish)
  })
  // @ts-expect-error nullish fallback cannot repair a failed arrow argument
  Expr.call(FFI.Value<(x: {}) => void>("consume"), nullish)
  // @ts-expect-error conditional best-common-type inference cannot erase the failure
  Decl.const_("conditional", (Math.random() < 2 ? bad : {}) ?? {})
  // @ts-expect-error a stage-2 conditional must check the erased branch
  Expr.cond(true, nullish, Expr.object({}))
  // @ts-expect-error an unshaped fallback is not a liftable stage-2 branch
  Expr.cond(true, bad, {})
  const filtered = [bad, {}].filter((x) => x !== undefined)
  // @ts-expect-error filtering undefined still leaves erased object elements
  Expr.call(FFI.Value<(...x: {}[]) => void>("consume"), ...filtered)
  // @ts-expect-error array spread cannot repair best-common-type erasure
  Decl.const_("spread", [...filtered])
  // @ts-expect-error nested object fields must reject the erased type too
  Decl.const_("nested", { candidate: nullish })
  // @ts-expect-error object spread cannot repair the erased type
  Decl.const_("objectSpread", { ...nullish })
  let narrowed = Math.random() < 2 ? bad : {}
  if (narrowed === undefined) narrowed = {}
  // @ts-expect-error narrowing undefined does not make an erased type liftable
  Decl.const_("narrowed", narrowed)
  // @ts-expect-error falsy fallback cannot repair a failed result
  Decl.const_("or", bad || {})

  // @ts-expect-error a unique-symbol brand is not a numeric index-signature value
  const numeric: Record<string, number> = bad ?? {}
  // @ts-expect-error a unique-symbol brand is not a never index-signature value
  const empty: Record<string, never> = bad ?? {}
  void numeric
  void empty
  const unknown: Record<string, unknown> = bad ?? {}
  // @ts-expect-error erasure into unknown-valued records is still not liftable
  Decl.const_("unknownRecord", unknown)
  // @ts-expect-error nested unknown-valued records are also not liftable
  Decl.const_("nestedRecord", { records: [unknown] })
}
void repro
