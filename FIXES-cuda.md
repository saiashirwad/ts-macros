# FIXES-cuda — c-family kit + CUDA target

Branch `fix/cuda`, base HEAD `2957397`. Two commits, merge in order:

1. `c7e4ec3` — extract the shared C-family kit; C target composes from it; ownership free policy
2. `72ba1fe` — add the CUDA target, example, and pinned test

Adapted from the old-design work in ts-macros-wt-targets (REPORT §1-6, commits
513efd4 + 72b9b1b) to the reshaped core: binding tag is now `"binding"`+kind,
function-ref/generic-function-ref are gone (all `var-ref`), emit/traversal is
gone (`src/walk.ts` exists; ownership uses it), the C target stays a
`c(types: Synthesis)` factory, `In<void>` is already fixed.

## 1. Shared C-family kit — targets/c-family/index.ts (NEW)

WHAT: the mechanical spellings every brace-language target shares, extracted
from targets/c/index.ts (the CUDA target was about to copy them). Two layers:

- helpers the deltas compose from: `IDENT`/`ident`, `UNARY`/`POSTFIX`/`PRIMARY`,
  `BINARY` (`===` -> `==`, precedence table), `declare`, `param`, `blockText`,
  `ifChain`, `primitiveType`, `arrayType`, `int`, `scalarOracle`,
  `synthesizedReturn`, `bindingDeclaration`
- a base target with a fail-prefix closure:

```ts
export interface CFamilyBase {
  readonly expr: Target<Fragment, string, string>["expr"]
  readonly statement: Omit<StatementHandlers<Fragment, string, string>, "binding" | "function-declaration">
  readonly type: Omit<TypeHandlers<Fragment, string, string>, "type-ref">
}
export const cFamily = (fail: (what: string) => never): CFamilyBase => ({ ... })
```

WHY: the shared handlers existed in one target and would be duplicated by the
second; a spread-override base is the emitter analog of the traversal spread
pattern, and `fail()` keeps every unsupported error prefixed with the calling
target's name. The three omitted keys are exactly the handlers that close over
per-target state (Synthesis, nominal-ref policy).

Note: the Owned brand (see §4) moved here and is re-exported through
targets/c/ownership.ts, so targets/c's public surface is unchanged.

## 2. ExprHandlers / StatementHandlers / TypeHandlers exported

WHAT (src/emit/index.ts, additive only):

```ts
export type {
  Emit,
  ExprHandlers,
  ExprNode,
  StatementHandlers,
  StatementNode,
  Target,
  TypeHandlers,
  TypeNode,
} from "./target.ts"
```

WHY: `CFamilyBase` needs to `Omit` per-target keys from the handler maps; the
types existed in target.ts but were not exported.

## 3. C target composes the kit — targets/c/index.ts, 211 -> 74 lines

WHAT:

```ts
export const c = (types: Synthesis): Target<Fragment, string, string> => {
  const base = cFamily(unsupported)
  return {
    expr: base.expr,
    statement: {
      ...base.statement,
      binding: (node, emit) =>
        bindingDeclaration(node, emit, types, unsupported),
      "function-declaration": (node, emit) => {/* as before */},
    },
    type: {
      ...base.type,
      "type-ref": (
        node,
        emit,
      ) => {/* Owned -> pointer, Int -> int, else ident */},
    },
  }
}
```

WHY: the remaining 74 lines are pure C policy — everything mechanical is in
the kit. `unsupported = (what) => { throw new Error(\`c target: \${what}\`) }`
keeps the error prefix the existing tests pin.

API change: none (`emitProgramC`, `c`, `int`, `insertFrees`, `isOwnedType`,
`Owned`, `owned` all still exported with the same shapes).

## 4. Ownership free policy — targets/c/ownership.ts + c-family Owned brand

WHAT:

```ts
// c-family
export type Owned<A, Free extends string = "free"> = A & OwnedBrand<Free>
export const owned = <A, const Free extends string = "free">(inner, free = "free" as Free) =>
  free === "free" ? Type.Ref("Owned", inner) : Type.Ref("Owned", inner, Type.Literal(free))
export const ownedFlavor = (type) => /* "free" unless the brand carries one */

// targets/c/ownership.ts
export type FreePolicy = (flavor: string, name: string) => Statement
const freeStatement: FreePolicy = (flavor, name) => Do(Fn.Call(FFI.Value<any>(flavor), FFI.Value(name)))
export const insertFrees = (statements, types, free: FreePolicy = freeStatement) => { ... }
```

The pass is unchanged except: `enclosing` now carries `{name, flavor}` pairs
instead of bare names, each binding records its flavor at registration, and
the three free sites call `free(binding.flavor, binding.name)`.

WHY: the liveness logic is allocator-agnostic; only the release call is not.
The flavor rides the brand (type-level `Owned<T, Free>`), the policy turns
flavor + name into a statement. Default behavior is byte-identical to before:
the default flavor is `"free"` and the default policy spells it as a call, so
`free(x)` is emitted exactly where it always was (all 6 existing ownership
tests pass unchanged).

API change: `owned(t, free?)` gains an optional second param;
`insertFrees(statements, types, free?)` gains an optional policy param.
New tests pin both: `owned(t, "strfree")` emits `strfree(s)` under the default
policy, and a custom policy receives `["free:s"]` and replaces the call.

## 5. CUDA target — targets/cuda/index.ts (NEW, 201 lines)

WHAT: `cFamily` spread + CUDA-only deltas:

```ts
export const kernel = (): Type.TypeExpr<void> => Type.Ref<void>("Kernel")
export const shared = <A>(inner) => Type.Ref<A>("Shared", inner)
export const f32 = (): Type.TypeExpr<number> => Type.Ref<number>("F32")
export type Ptr<A> = A & PtrBrand
export const ptr = <A>(inner) => Type.Ref<Ptr<A>>("Ptr", inner)
export const cudaFn = <R = unknown, const P extends readonly Type.TypeExpr<any>[] = ...>(name, params) =>
  makePipeable({ tag: "var-ref", name, params }) as /* (phantom from P) => R */
export type Launched<K> = K & { readonly launch: { readonly grid; readonly block } }
export const launch = (kernelRef, grid, block) =>
  makePipeable({ tag: "var-ref", name: kernelRef.name, launch: { grid, block } })
```

- `kernel()` is now a **void** phantom (`Type.Ref<void>`): with `In<void>`
  fixed, an impl that falls off the end typechecks — no phantom-return hack.
  `qualifierOf` sees the `Kernel` ref and the function-declaration handler
  renders `__global__ void` by CUDA law.
- type-ref handler: `Int` -> `int`, `F32` -> `float`, `Shared` ->
  `__shared__ T`, `Ptr` -> inner, `Owned` -> inner (device pointers are
  pointers), else ident.
- call-expr handler: callee with a `launch` field renders
  `name<<<grid, block>>>(args)`; otherwise args whose recorded param is
  `Ptr<T>` render as `&arg`.
- `emitProgramCuda` = collectImports check + `insertFrees` (flavor-aware:
  `owned(t, "cudaFree")` -> `cudaFree(t)` after last use, `owned(t)` ->
  `free(t)`) + synthesize + includes. Same lowering-then-resynthesize order
  as emitProgramC.

WHY for the shape: the C target's ~75 policy lines are reused verbatim through
the kit; only the qualifiers, widths, launch spelling, and out-param
convention are CUDA's.

## 6. Ptr<T> in-place-call — the address-of workaround, and its caveat

WHAT: `cudaMalloc` in real cuda_runtime is `cudaError_t cudaMalloc(void **,
size_t)` — the pointer comes back through an out-param. The IR has no `&x`
node, so the old PoC declared an FFI lie (`(bytes) => Owned<number[]>`)
emitting uncompilable `float *d_a = cudaMalloc(...)`. The narrow fix keeps the
signature honest: `cudaFn("cudaMalloc", [ptr(floats()), Type.Number()])`
records the param types on the var-ref, and the call handler lowers the
matching argument position to its address:

```c
float *d_a;
cudaMalloc(&d_a, n * sizeof(float));   // param 0 is Ptr<float[]>
cudaFree(d_a);                         // param 0 is float[] — plain call
```

WHY no core node: an address-of node (or a general intrinsic) is a core change
every target must handle, for one target's out-params. The marker instead
lives on the FFI signature — target-local, zero core change.

Caveats (deliberate narrowness):

- Phantoms are erased at runtime, so a plain `$.Value` cannot carry `Ptr`
  params — only `cudaFn` calls get the convention. The recorded params are a
  runtime descriptor invisible to walk/synthesize (same status as launch's
  config field; second use of the piggyback — a third use is the trigger to
  consider a core node).
- Lowering is positional against the recorded signature: the signature is the
  single source of truth, and marking the wrong param `Ptr` emits `&arg`
  where the callee wants the value. The convention assumes the argument is a
  variable; it does not guard complex args.

## 7. Kernel launch stays the callee-config piggyback

WHAT: unchanged mechanism from the old PoC — `launch(k, grid, block)` returns
a var-ref carrying a `launch` config field; the CUDA call-expr handler spells
it `name<<<grid, block>>>(args)`, every other emitter reads it as a plain
call. Types flow through unchanged.

WHY: rule-of-two lean. The piggyback is invisible to traversal/synthesize and
needs a cast in one handler, but it costs zero core nodes and the call site
stays fully typed. Revisit only when a second target needs the trick.

## 8. Void kernels typecheck (In<void>, already in base)

WHAT (example): a real falling-off-the-end kernel impl:

```ts
$.Returns(kernel()),
$.Impl(function*({ out, a, b, n }) {
  const i = yield* Binding.Const("i").pipe(Binding.Init(...), Binding.Annotate(int()))
  const tile = yield* Binding.Let("tile").pipe(Binding.Annotate(shared(f32())))
  yield* $.Assign(tile, $.Index(a, i))
  yield* $.Do($.Call(syncthreads))
  yield* $.If($.lt(i, n), function*() { ... })   // no return statement
})
```

The generator falls off the end; `TR = void` extends `In<void>` and
`materializeValue` skips the implicit return. Emits `__global__ void vec_add(...)`
with a body that ends on the if. Verified by tsc (bun does not typecheck).

## 9. Example + test

- examples/examples-cuda.ts: vector-add with the honest cudaMalloc/cudaFree/
  cudaMemcpy signatures, a void kernel, shared memory (declared then assigned
  — the old PoC's `const __shared__ float tile = 0;` is invalid CUDA, shared
  vars cannot have initializers), a launch, and per-flavor automatic frees.
- targets/cuda/cuda.test.ts pins the full emitted source (no nvcc on this
  machine) plus the `&d_a` vs `d_a` distinction.

Emitted source (excerpts):

```c
__global__ void vec_add(float *out, float *a, float *b, int n) {
  const int i = blockIdx->x * blockDim->x + threadIdx->x;
  __shared__ float tile;
  tile = a[i];
  __syncthreads();
  if (i < n) { out[i] = a[i] + b[i] * tile; }
}
int main(void) {
  ...
  float *d_a;
  cudaMalloc(&d_a, n * sizeof(float));
  ...
  free(b);
  vec_add<<<blocks, threads>>>(d_out, d_a, d_b, n);
  cudaFree(d_a);
  cudaFree(d_b);
  ...
}
```

## Line counts (goals were approximate, adapted not forced)

- targets/c/index.ts: 211 -> **74** lines of policy (goal ~75)
- targets/c-family/index.ts: **233** (goal ~215; the extra is the Owned
  free-flavor machinery this branch added)
- targets/cuda/index.ts: **201** (goal ~159; the extra is the Ptr/cudaFn/
  launch surface the reference target lacked — it predates deliverable 3)

## Verification

- `bun test`: 118 pass / 10 files (114 baseline + 2 CUDA + 2 ownership), 0 fail
- `./node_modules/.bin/tsc --noEmit`: clean (bun strips types; void-kernel and
  cudaFn phantom claims are tsc-verified)
- `./node_modules/.bin/dprint fmt` + `check`: clean
- the DSA test still compiles the emitted C with cc (`-std=c11 -Wall -Werror`)
  and runs it

## Still missing for compile-verified CUDA

- No nvcc on this machine: the emitted source is pinned by test, not compiled.
- Real cuda_runtime fidelity: `cudaMalloc`/`cudaFree`/`cudaMemcpy` return
  `cudaError_t`; the example ignores the returns (no error checking — if-chains
  exist and could express it, but it is not wired) and passes int byte counts
  where `size_t` is expected (implicit non-negative conversions).
- `<<<grid, block>>>` takes `dim3`; ints convert implicitly. A struct/dim3
  story is blocked on object-literal -> struct support, which the kit still
  rejects.
- Kernel launches from a separate host/device file split would need the
  program-level artifact hook (old REPORT §6.1) — includes stay hardcoded
  strings in emitProgramCuda.
