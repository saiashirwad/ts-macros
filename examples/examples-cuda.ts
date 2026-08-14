import * as $ from "../src/$.ts"
import * as Binding from "../src/binding.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
import { cudaFn, emitProgramCuda, f32, int, kernel, launch, type Owned, owned, ptr, shared } from "../targets/cuda/index.ts"

const floats = () => Type.Array(f32())
const sizeofFloat = () => $.Call($.Value<(type: any) => number>("sizeof"), $.Value<any>("float"))

const malloc = $.Value<(bytes: number) => Owned<number[]>>("malloc")
const printf = $.Value<(format: string, ...args: any[]) => number>("printf")
// device pointers come back through an out-param, so the signature records
// Ptr<float[]> and the call site passes the variable's address
const cudaMalloc = cudaFn<number>("cudaMalloc", [ptr(floats()), Type.Number()])
const cudaFree = cudaFn<number>("cudaFree", [floats()])
const cudaMemcpy = cudaFn<number>("cudaMemcpy", [floats(), floats(), Type.Number(), Type.Number()])
const hostToDevice = $.Value<number>("cudaMemcpyHostToDevice")
const deviceToHost = $.Value<number>("cudaMemcpyDeviceToHost")
const syncthreads = $.Value<() => void>("__syncthreads")

const blockIdx = $.Value<{ x: number; y: number; z: number }>("blockIdx")
const threadIdx = $.Value<{ x: number; y: number; z: number }>("threadIdx")
const blockDim = $.Value<{ x: number; y: number; z: number }>("blockDim")

export const program = Program.build(function*() {
  // a kernel falls off the end: In<void> accepts a plain void generator, so
  // no phantom return is needed
  const vecAdd = yield* $.Function("vec_add").pipe(
    $.Params($.Param("out", floats()), $.Param("a", floats()), $.Param("b", floats()), $.Param("n", int())),
    $.Returns(kernel()),
    $.Impl(function*({ out, a, b, n }) {
      const i = yield* Binding.Const("i").pipe(
        Binding.Init($.add($.mul($.Prop(blockIdx, "x"), $.Prop(blockDim, "x")), $.Prop(threadIdx, "x"))),
        Binding.Annotate(int()),
      )
      const tile = yield* Binding.Let("tile").pipe(Binding.Annotate(shared(f32())))
      yield* $.Assign(tile, $.Index(a, i))
      yield* $.Do($.Call(syncthreads))
      yield* $.If($.lt(i, n), function*() {
        yield* $.Assign($.Index(out, i), $.add($.Index(a, i), $.mul($.Index(b, i), tile)))
      })
    }),
  )

  const main = yield* $.Function("main").pipe(
    $.Returns(int()),
    $.Impl(function*() {
      const n = yield* $.Const("n", 256).pipe(Binding.Annotate(int()))
      const threads = yield* $.Const("threads", 256).pipe(Binding.Annotate(int()))
      const blocks = yield* $.Const("blocks", $.div($.add($.sub(n, 1), threads), threads)).pipe(Binding.Annotate(int()))
      const a = yield* $.Const("a", $.Call(malloc, $.mul(n, sizeofFloat()))).pipe(Binding.Annotate(owned(floats())))
      const b = yield* $.Const("b", $.Call(malloc, $.mul(n, sizeofFloat()))).pipe(Binding.Annotate(owned(floats())))
      const i = yield* $.Let("i", 0).pipe(Binding.Annotate(int()))
      yield* $.While($.lt(i, n), function*() {
        yield* $.Assign($.Index(a, i), i)
        yield* $.Assign($.Index(b, i), $.mul(i, 2))
        yield* $.Assign(i, $.add(i, 1))
      })
      const d_a = yield* Binding.Let("d_a").pipe(Binding.Annotate(owned(floats(), "cudaFree")))
      const d_b = yield* Binding.Let("d_b").pipe(Binding.Annotate(owned(floats(), "cudaFree")))
      const d_out = yield* Binding.Let("d_out").pipe(Binding.Annotate(owned(floats(), "cudaFree")))
      yield* $.Do($.Call(cudaMalloc, d_a, $.mul(n, sizeofFloat())))
      yield* $.Do($.Call(cudaMalloc, d_b, $.mul(n, sizeofFloat())))
      yield* $.Do($.Call(cudaMalloc, d_out, $.mul(n, sizeofFloat())))
      yield* $.Do($.Call(cudaMemcpy, d_a, a, $.mul(n, sizeofFloat()), hostToDevice))
      yield* $.Do($.Call(cudaMemcpy, d_b, b, $.mul(n, sizeofFloat()), hostToDevice))
      yield* $.Do($.Call(launch(vecAdd, blocks, threads), d_out, d_a, d_b, n))
      yield* $.Do($.Call(cudaMemcpy, a, d_out, $.mul(n, sizeofFloat()), deviceToHost))
      yield* $.Do($.Call(printf, $.String("a[0] = %f\n"), $.Index(a, $.Number(0))))
      return $.norm(0)
    }),
  )

  return main
})

export const source = emitProgramCuda(program)

if (import.meta.main) {
  console.log(source)
}
