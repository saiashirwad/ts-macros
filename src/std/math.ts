import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"

export const Math = FFI.Value<Math>("Math")

export const floor = Expr.Prop(Math, "floor")
export const max = Expr.Prop(Math, "max")
export const PI = Expr.Prop(Math, "PI")
