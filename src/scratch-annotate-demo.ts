// import * as $ from "./$.ts"
// import * as Binding from "./binding.ts"
// import * as Expr from "./expr.ts"
// import * as Program from "./program.ts"
// import * as Type from "./types/index.ts"
//
// export const program = Program.build(function*() {
//   const ok = yield* $.Const("ok").pipe(
//     $.Init($.String("hi")),
//     $.Annotate(Type.String()),
//   )
//
//   const bad = yield* $.Const("bad").pipe(
//     $.Init($.String("hi")),
//     $.Annotate(Type.Number()),
//   )
//
//   return ok
// })
