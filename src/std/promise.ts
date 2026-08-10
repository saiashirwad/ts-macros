import * as FFI from "../ffi.ts"
import type * as Fn from "../function.ts"
import * as Type from "../types/index.ts"

const T = Type.Param("T")

export const Promise = Type.Ref<Type.Fn<[typeof T], Type.Generic<"Promise", [Type.Variable<"T">]>>>("Promise")

export const PromiseConstructor = FFI.Value<PromiseConstructor>("Promise")

export const resolve = FFI.GenericProp<
  [Fn.Param<"value", Type.Variable<"T">>],
  Type.Generic<"Promise", [Type.Variable<"T">]>,
  [typeof T]
>()(PromiseConstructor, "resolve")
