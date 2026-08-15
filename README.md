# ts-macros

`ts-macros` is a TypeScript metaprogramming system for building typed programs as data and emitting them for another runtime.

Instead of assembling source code as strings, you build expressions, statements, functions, types, and references through a typed API. The result is a structured intermediate representation that can be inspected, validated, transformed, and emitted.

```ts
const classify = yield * $.Function("classify").pipe(
  $.Params($.Param("score", Type.Number())),
  $.Impl(function*({ score }) {
    return $.Cond(
      $.Binary(">=", score, $.Number(60)),
      $.String("pass"),
      $.String("fail"),
    )
  }),
)
```

The project is still evolving. The current implementation focuses on typed program construction, scope validation, references, functions, expressions, and emission through a target backend. The design goal is to keep semantic information available for as long as possible instead of collapsing a program into text too early.

## Where it is going

The longer-term goal is a system where the intermediate representation is the main artifact and emitters are replaceable backends. That makes it possible to build tools that understand a program before running it: analyzers, optimizers, visualizers, policy checks, and multiple execution targets can all work from the same representation.

One promising application is agent code mode. An agent could describe a multi-step workflow—searching files, preparing patches, requesting approval, and running tests—as a typed program. The runtime could inspect its required capabilities, enforce policies and budgets, show a preview, and then execute or resume it.

That direction will require an effect system for capabilities such as file access, shell commands, network calls, model calls, and subagents. The first execution target would likely be an Effect program, while JSON, JavaScript, and other emitters remain views or backends over the same semantic model.

The immediate question is simple: can a typed, inspectable program representation give agents useful control over work that would otherwise be hidden inside a string of generated TypeScript?
