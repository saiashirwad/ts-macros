import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"

export const Console = FFI.Value<Console>("console")

export const log = Expr.Prop(Console, "log")
