# Code mode for agent workflows

## The idea

Use `ts-macros` as a typed code-mode language for agent workflows. The agent can write a small program to accomplish a multi-step task, but the program is captured as an inspectable intermediate representation instead of being executed as unrestricted TypeScript.

```text
Agent writes a workflow
        ↓
Typed macro IR
        ↓
Effect and capability checking
        ↓
Budget, dependency, and policy checks
        ↓
Preview, transform, or approve
        ↓
Generate an Effect program or JavaScript
        ↓
Execute
```

The point is to let the agent express loops, branching, intermediate values, batching, and reusable helpers while keeping the runtime aware of what the program is going to do before it runs.

## Why this is different from plain TypeScript

An ordinary TypeScript program contains opaque calls such as `writeFile()` or `runCommand()`. The macro IR can represent those operations as known effects, so the runtime can inspect the whole workflow and enforce policy before execution.

For example, a coding workflow might express:

```ts
const files = yield* search("packages/**/*.ts")

for (const file of files) {
  const source = yield* read(file)
  const updated = yield* transform(source)
  yield* write(file, updated)
}

yield* runTests()
```

Before running it, ROOP could derive:

```text
Capabilities: FileRead, FileWrite, TestExecution
Approval: writes and test execution
Parallelizable: independent reads and transformations
Trace: search → read → transform → write → tests
```

The same representation could drive execution, previews, approval requests, tracing, retries, caching, and policy checks.

## Useful modes

- Simple tasks can continue to use direct tool calls.
- Multi-step tasks can be expressed as one macro workflow and executed after checking.
- High-risk tasks can produce a preview or patch for approval before any external effects occur.

## Potential ROOP role

This would make `ts-macros` useful for the agent control plane rather than requiring it to replace ordinary application code. Agents could still write normal TypeScript in a user repository, while agent-generated orchestration programs use the macro system for tool workflows, subagent coordination, approvals, and resource policies.

The custom effects system could describe capabilities, failures, ownership, retryability, reversibility, cost, latency, and parallelism. These properties would be useful only when they are attached to trusted operations; arbitrary imported functions remain an escape hatch and must be treated as opaque or explicitly trusted.

## Questions to investigate

- What is the smallest effect vocabulary for useful coding workflows?
- Should the macro program compile to Effect, direct JavaScript, or both?
- How should dynamic values such as discovered file names appear in the IR?
- Which checks belong in TypeScript types and which require an IR pass?
- How do approval, interruption, retry, and resumption work for partially executed programs?
- Can the same IR support direct execution, dry runs, traces, and replay?

The first useful prototype is a small coding workflow language with `search`, `read`, `write`, `patch`, `run`, `model`, `parallel`, and `approval` effects, plus a compiler pass that reports required capabilities and produces an execution preview.
