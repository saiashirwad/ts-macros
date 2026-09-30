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
}
void repro
