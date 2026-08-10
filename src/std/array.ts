import * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"
import * as Type from "../types/index.ts"

const T = Type.Param("T")

export const Array = Type.Ref<Type.Fn<[typeof T], Type.Generic<"Array", [Type.Variable<"T">]>>>("Array")

export const ArrayConstructor = FFI.Value<ArrayConstructor>("Array")

export const isArray = Expr.Prop(ArrayConstructor, "isArray")
