```ts
const fetchAndSave =
  yield *
  $.function("fetchAndSave").pipe(
    $.params($.p("id", type.number())),
    // effects inferred: Http | DbWrite | throws(string)
    $.impl(function* ({ id }) {
      const fetched = yield* $.do("fetched").pipe(
        $.perform($.call(fetchUser, [id])),
      )
      const saved = yield* $.do("saved").pipe(
        $.perform($.call(saveUser, [fetched])),
      )
      return saved
    }),
  )
```
