import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"

const repro = () => {
  const returns = Math.random() < 2 ? Type.string : Type.number
  Program.build(function*() {
    // @ts-expect-error the final return must satisfy every possible annotation
    return yield* Decl.fn("actual", {
      returns,
      body: function*() {
        return 1
      },
    })
  })
  const arrow = Expr.arrow({
    returns,
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error arrows use the same check against each annotation
  Decl.const_("arrow", arrow)
  const early = Expr.arrow({
    returns,
    body: function*() {
      yield* Stmt.return_(1)
      return FFI.Value<never>("unreachable")
    },
  })
  // @ts-expect-error early returns must also satisfy every possible annotation
  Decl.const_("early", early)
  // A single union annotation really does denote a union and remains valid.
  Program.build(function*() {
    return yield* Decl.fn("valid", {
      returns: Type.union(Type.string, Type.number),
      body: function*() {
        return 1
      },
    })
  })

  const optionalLiteral = Math.random() < 2 ? undefined : Type.literal("A")
  Program.build(function*() {
    const fn = yield* Decl.fn("fn", {
      returns: optionalLiteral,
      body: function*() {
        return "A"
      },
    })
    // @ts-expect-error absent annotations widen the plain return to string
    return yield* Decl.const_("actual", Expr.call(fn), Type.literal("A"))
  })
  const annotation = Type.object({ ok: Type.literal(true) })
  const optionalObject = Math.random() < 2 ? undefined : annotation
  Program.build(function*() {
    const fn = yield* Decl.fn("fn", {
      returns: optionalObject,
      body: function*() {
        return { ok: true }
      },
    })
    // @ts-expect-error absent annotations widen the plain field to boolean
    return yield* Decl.const_("actual", Expr.call(fn), annotation)
  })
  const optionalArrow = Expr.arrow({
    returns: optionalLiteral,
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error arrows also account for unannotated inference
  Decl.const_("actual", Expr.call(optionalArrow), Type.literal("A"))
}
void repro
