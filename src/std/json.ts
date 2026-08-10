import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"

export const JSON = FFI.Value<globalThis.JSON>("JSON")
export const parse = Expr.Prop(JSON, "parse")
export const stringify = Expr.Prop(JSON, "stringify")
