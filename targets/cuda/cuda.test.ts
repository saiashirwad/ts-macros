import assert from "node:assert/strict"
import { test } from "node:test"

import { source } from "../../examples/examples-cuda.ts"

const EXPECTED = `#include <cuda_runtime.h>
#include <stdio.h>

__global__ void vec_add(float *out, float *a, float *b, int n) {
  const int i = blockIdx->x * blockDim->x + threadIdx->x;
  __shared__ float tile;
  tile = a[i];
  __syncthreads();
  if (i < n) {
    out[i] = a[i] + b[i] * tile;
  }
}
int main(void) {
  const int n = 256;
  const int threads = 256;
  const int blocks = (n - 1 + threads) / threads;
  float *a = malloc(n * sizeof(float));
  float *b = malloc(n * sizeof(float));
  int i = 0;
  while (i < n) {
    a[i] = i;
    b[i] = i * 2;
    i = i + 1;
  }
  float *d_a;
  float *d_b;
  float *d_out;
  cudaMalloc(&d_a, n * sizeof(float));
  cudaMalloc(&d_b, n * sizeof(float));
  cudaMalloc(&d_out, n * sizeof(float));
  cudaMemcpy(d_a, a, n * sizeof(float), cudaMemcpyHostToDevice);
  cudaMemcpy(d_b, b, n * sizeof(float), cudaMemcpyHostToDevice);
  free(b);
  vec_add<<<blocks, threads>>>(d_out, d_a, d_b, n);
  cudaFree(d_a);
  cudaFree(d_b);
  cudaMemcpy(a, d_out, n * sizeof(float), cudaMemcpyDeviceToHost);
  cudaFree(d_out);
  printf("a[0] = %f\\n", a[0]);
  free(a);
  return 0;
}`

test("the cuda target emits a void kernel, a launch, qualifiers, and Ptr out-param calls", () => {
  assert.equal(source, EXPECTED)
})

test("Ptr params lower to the argument's address; other calls pass the value", () => {
  const lines = source.split("\n")
  assert.ok(lines.includes("  cudaMalloc(&d_a, n * sizeof(float));"))
  assert.ok(lines.includes("  cudaFree(d_a);"))
})
