# Big Brain Ideas for ts-macros

## 1. ts-macros as a Better Effect System than Effect-ts

ts-macros can encode a much more efficient effect system than Effect-ts because effects are resolved at compile-time. Effect-ts pays runtime costs for its `Effect<R, E, A>` encoding (generators, fibers, the scheduler). ts-macros emits the minimal runtime needed.

Key advantages:
- **Compile-time effect resolution** — the macro knows the full effect graph at codegen time
- **Smaller fiber runtime** — only include what the program actually uses
- **More elegant abstractions** — the `yield*` + typed ref pattern is cleaner than Effect-ts's pipe chains
- **Faster compiled output** — inline simple effects, generate specialized schedulers, dead-code-eliminate unused handlers, emit direct `async/await` when the effect graph is trivially async

Agents can write ts-macros code reliably. The DSL is well-typed and follows consistent patterns (`yield*`, `.pipe()`, builder methods) that LLMs excel at.

---

## 2. ts-macros vs Cloudflare Dynamic Workers — Compile-time Sandboxing

Cloudflare's Dynamic Workers (March 2026) solve "AI generates code, how do we run it safely?" with runtime V8 isolates. ts-macros solves it differently: **generate structured macro code that is statically verified to be safe, so you don't need runtime sandboxing.**

### Effect tracking replaces runtime sandboxing

Dynamic Workers use RPC bridges and `globalOutbound` callbacks for runtime capability enforcement. ts-macros can enforce capabilities at compile time:

```ts
const agentAction = yield* $.function("agentAction").pipe(
  $.effects($.http("api.example.com"), $.dbRead),  // declared capabilities
  $.params($.p("input", type.string())),
  $.impl(function* ({ input }) {
    // compiler rejects any $.perform() not covered by declared effects
    const data = yield* $.do("data").pipe(
      $.perform($.call(fetchFromAPI, [input]))
    );
    return data;
  }),
);
```

If the AI tries to generate code that accesses the filesystem when only `$.http` was granted, **it doesn't compile**. No isolate needed.

### Token efficiency, squared

ts-macros IR is more token-efficient than TypeScript itself. An AI generating macro code works with typed refs, not raw source text.

### Zero runtime cost

Dynamic Workers still pay isolate startup (ms), RPC bridge serialization, per-worker charges ($0.002/day), and memory per isolate. ts-macros compiles to plain JS. The "sandboxing" was done at compile time.

### Program algebra > RPC bridges

ts-macros' planned program algebra lets one macro program import another's typed refs directly — no serialization, no network hop. The composed program emits as a single JS bundle.

**Positioning: ts-macros is the compile-time alternative to runtime sandboxing for AI-generated code.**

---

## 3. Complexity Tracking in the IR

Since ts-macros builds a semantic IR (not strings), it can compute cyclomatic and algorithmic complexity at compile time.

### Cyclomatic complexity — trivial

Walk the IR and count decision points (branches, loops, logical operators):

```ts
const handler = yield* $.function("handler").pipe(
  $.params($.p("input", type.string())),
  $.impl(function* ({ input }) {
    yield* $.if(condition1, function* () {        // +1
      yield* $.if(condition2, function* () {      // +1
        // ...
      });
    }).else(function* () {                        // +1
      yield* $.for(items, function* (item) {      // +1
        // ...
      });
    });
    return result;
  }),
  $.complexity({ max: 10 }),  // compile-time budget enforcement
);
```

### Algorithmic complexity — conservative inference

- **No loops** -> O(1)
- **Single `$.for` over input** -> O(n)
- **Nested `$.for`** -> O(n*m), flag as O(n^2) when same collection
- **`$.call` to a ref whose complexity is known** -> compose
- **Recursion through refs** -> detectable, flag as unbounded or require annotation

### Concrete uses

- **Budget enforcement for AI-generated code** — complexity budget + effect budget = static sandboxing
- **Automatic decomposition** — macro detects high complexity and factors out branches into subfunctions during codegen
- **Optimization selection** — low complexity loop body -> inline; high complexity -> extract to named function
- **Derive macro guardrails** — `$.derive(Eq)` on deeply nested type catches O(n^3) equality and suggests hash-based approach
- **Cost estimation for serverless** — CPU time = money, flag expensive handlers before deployment

The key insight: complexity isn't a metric to report — it's a **signal the compiler uses to make decisions**. Only possible because ts-macros sees structure before emitting code.

### Effect complexity — a new dimension

Track how many distinct effects a function touches:
- 0 effects -> pure, freely optimizable
- 1 effect -> simple, easy to test/mock
- 5+ effects -> "god function" smell, suggest decomposition

---

## 4. Proxy-based Ergonomic API

Use JavaScript Proxies to make refs behave like the values they represent. The macro code reads almost identically to the output code.

### How it works

Every ref returned by `yield*` gets wrapped in a Proxy:

```ts
function makeRefProxy<T>(ref: VarRef<T>): ProxiedRef<T> {
  return new Proxy(ref, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive || prop === RAW_REF) return target;
      return makeRefProxy(ir.member(target, prop));
    },
    apply(target, thisArg, args) {
      return makeRefProxy(ir.call(target, args));
    },
  });
}
```

Every operation returns another proxy. `user.posts.filter(p => p.draft).length` builds a tree of IR nodes.

### Before and after

```ts
// BEFORE — explicit IR construction
const user = yield* $.do("user").pipe(
  $.perform($.call(getUser, [id]))
);
const name = $.member(user, "name");
const upper = $.call($.member(name, "toUpperCase"), []);

// AFTER — proxied refs
const user = yield* getUser(id);
const name = user.name;
const upper = name.toUpperCase();
```

### Type safety through branded proxied types

```ts
const getUser: ProxiedFn<(id: number) => User>

getUser(42);         // returns ProxiedRef<User>
getUser("hello");    // type error
user.name;           // ProxiedRef<string>
user.nonexistent;    // type error
```

### Full example — effectful code with proxy API

```ts
// ---- Types ----

const User = yield* $.type("User").pipe(
  $.body(type.object({
    id: type.number(),
    name: type.string(),
    email: type.string(),
    role: type.union(type.literal("admin"), type.literal("user")),
  })),
);

const Post = yield* $.type("Post").pipe(
  $.body(type.object({
    id: type.number(),
    title: type.string(),
    body: type.string(),
    authorId: type.number(),
    draft: type.boolean(),
  })),
);

// ---- Effect-tracked services ----

const db = yield* $.service("db").pipe(
  $.effect($.dbRead, $.dbWrite),
  $.methods({
    query: $.fn([$.p("sql", type.string())], type.array(type.any())),
    insert: $.fn([$.p("table", type.string()), $.p("row", type.any())], type.void()),
  }),
);

const http = yield* $.service("http").pipe(
  $.effect($.io),
  $.methods({
    get: $.fn([$.p("url", type.string())], type.any()),
    post: $.fn([$.p("url", type.string()), $.p("body", type.any())], type.any()),
  }),
);

const logger = yield* $.service("logger").pipe(
  $.effect($.log),
  $.methods({
    info: $.fn([$.p("msg", type.string())], type.void()),
    error: $.fn([$.p("msg", type.string()), $.p("err", type.unknown())], type.void()),
  }),
);

// ---- Pure functions — no effects, no yield* ----

const fullName = yield* $.function("fullName").pipe(
  $.params($.p("user", User)),
  $.returns(type.string()),
  $.impl(({ user }) => {
    return $.template`${user.name} <${user.email}>`;
  }),
);

const isAdmin = yield* $.function("isAdmin").pipe(
  $.params($.p("user", User)),
  $.returns(type.boolean()),
  $.impl(({ user }) => {
    return user.role.eq("admin");
  }),
);

// ---- Effectful functions — yield* marks effect boundaries ----

const getUser = yield* $.function("getUser").pipe(
  $.params($.p("id", type.number())),
  $.returns(type.promise(User)),
  $.effects($.dbRead, $.log),
  $.impl(function* ({ id }) {
    yield* logger.info($.template`fetching user ${id}`);
    const rows = yield* db.query($.template`SELECT * FROM users WHERE id = ${id}`);
    return rows[0];
  }),
);

const getUserPosts = yield* $.function("getUserPosts").pipe(
  $.params($.p("userId", type.number()), $.p("includeDrafts", type.boolean())),
  $.returns(type.promise(type.array(Post))),
  $.effects($.dbRead),
  $.impl(function* ({ userId, includeDrafts }) {
    const posts = yield* db.query(
      $.template`SELECT * FROM posts WHERE author_id = ${userId}`
    );
    return $.ternary(
      includeDrafts,
      posts,
      posts.filter(p => p.draft.eq(false)),
    );
  }),
);

// ---- Composing effectful functions — effects propagate ----

const getUserDashboard = yield* $.function("getUserDashboard").pipe(
  $.params($.p("userId", type.number())),
  // effects inferred: dbRead + log (from getUser) + dbRead (from getUserPosts)
  $.impl(function* ({ userId }) {
    const user = yield* getUser(userId);
    const posts = yield* getUserPosts(userId, false);

    return $.object({
      name: user.name,
      email: user.email,
      isAdmin: isAdmin(user),
      displayName: fullName(user),
      publishedCount: posts.length,
      recentPosts: posts.slice(0, 5),
    });
  }),
);

// ---- Error handling ----

const safeGetUser = yield* $.function("safeGetUser").pipe(
  $.params($.p("id", type.number())),
  $.effects($.dbRead, $.log),
  $.impl(function* ({ id }) {
    return yield* $.try(function* () {
      return yield* getUser(id);
    }).catch(function* (err) {
      yield* logger.error($.template`failed to fetch user ${id}`, err);
      return $.null();
    });
  }),
);

// ---- Webhook handler with multiple effects ----

const handleWebhook = yield* $.function("handleWebhook").pipe(
  $.params($.p("event", type.string()), $.p("payload", type.any())),
  $.effects($.dbRead, $.dbWrite, $.io, $.log),
  $.impl(function* ({ event, payload }) {
    yield* logger.info($.template`webhook: ${event}`);

    yield* $.match(event)
      .case("user.created", function* () {
        const profile = yield* http.get($.template`/api/enrich/${payload.email}`);
        yield* db.insert("profiles", $.object({
          userId: payload.id,
          company: profile.company,
          avatar: profile.avatar,
        }));
      })
      .case("user.deleted", function* () {
        yield* db.query($.template`DELETE FROM profiles WHERE user_id = ${payload.id}`);
        yield* http.post("/api/cleanup", $.object({ userId: payload.id }));
      })
      .case("post.published", function* () {
        const user = yield* getUser(payload.authorId);
        yield* http.post("/api/notify", $.object({
          to: user.email,
          subject: $.template`Your post "${payload.title}" is live`,
        }));
      })
      .exhaustive();
  }),
);

// ---- Generic + proxied ----

const T = type.param("T");
const U = type.param("U");

const mapArray = yield* $.function("mapArray").pipe(
  $.typeParams(T, U),
  $.params(
    $.p("items", type.array(T)),
    $.p("fn", type.fn([T], U)),
  ),
  $.returns(type.array(U)),
  $.impl(({ items, fn }) => {
    return items.map(fn);
  }),
);

// ---- Composing in main — pure vs effectful ----

const main = yield* $.function("main").pipe(
  $.effects($.dbRead, $.dbWrite, $.io, $.log),
  $.impl(function* () {
    const users = yield* db.query("SELECT * FROM users");

    // Pure transforms — no yield*, proxies chain naturally
    const admins = users.filter(isAdmin);
    const emails = admins.map($.fn(u => u.email));
    const summary = $.object({
      total: users.length,
      adminCount: admins.length,
      emails,
    });

    yield* http.post("/api/report", summary);
    yield* logger.info($.template`reported ${admins.length} admins`);
  }),
);
```

### Serialization of callbacks

Bare arrows like `u => u.email` work via proxy tracing: the proxy creates a phantom arg, passes it through the arrow, and captures the resulting IR. This works **only** when everything inside the arrow touches proxied refs.

For clarity, `$.fn` signals "trace this":

```ts
users.filter(isAdmin);                    // ref-pass — cleanest
admins.map($.fn(u => u.email));           // explicit trace
users.filter($.fn(u => u.role.eq("admin")));  // traced comparison
```

The constraint: everything the arrow touches must be a proxy or a literal. Raw JS closures inside a traced arrow are a compile error.

---

## 5. Type-level Complexity Tracking with Tuples

Encode complexity as type-level natural numbers using tuple length. TypeScript can't do arithmetic on number literals, but tuples give you Peano arithmetic:

```ts
// Complexity = tuple whose length IS the number
type Complexity<N extends any[]> = N;
type Zero = [];
type One = [1];
type Three = [1, 1, 1];

// Addition = tuple concatenation
type Add<A extends any[], B extends any[]> = [...A, ...B];

// Budget check
type Exceeds<C extends any[], Max extends any[]> =
  Max extends [...C, ...any[]] ? false : true;

type AssertBudget<C extends any[], Max extends any[]> =
  Exceeds<C, Max> extends true ? never : C;
```

Functions carry complexity in their type:

```ts
type TrackedFn<
  Args extends any[],
  Return,
  C extends any[],        // complexity
  E extends EffectTag[]   // effects
>

// isAdmin: 1 branch -> complexity [1]
const isAdmin: ProxiedFn<(u: User) => boolean, [1]>

// getUser: 3 branches -> complexity [1, 1, 1]
const getUser: ProxiedFn<(id: number) => User, [1, 1, 1]>

// composing adds tuples
const getDashboard: ProxiedFn<
  (id: number) => Dashboard,
  [1, 1, 1, 1]  // 3 + 1 = 4
>
```

Budget enforcement becomes a type error:

```ts
const handler = yield* $.function("handler").pipe(
  $.maxComplexity<[1,1,1,1,1]>(),  // max 5
  $.impl(function* ({ id }) {
    const user = yield* getUser(id);        // +3
    const posts = yield* getUserPosts(id);  // +4
    yield* $.if(isAdmin(user), function* () {  // +1
      // ...
    });
    // total: 8 exceeds 5 -> type error via AssertBudget -> never
  }),
);
```

Effects use the same encoding — a tuple of effect tags. TypeScript itself enforces both complexity and capability budgets as type errors. The macro generates these types, but **the type checker does the policing for free**.

---

## 6. Advanced IR Tracking — Beyond Cyclomatic Complexity

Since the proxy + IR combination gives ts-macros full semantic understanding of the program, we can track things that no other tool can.

### Data Lineage / Provenance

Track where every value came from, through every transformation, to where it exits the system:

```ts
const handler = yield* $.function("handler").pipe(
  $.impl(function* ({ req }) {
    const email = yield* db.query(/*...*/);       // origin: db.users.email
    const enriched = yield* http.get(/*...*/);     // origin: api.clearbit

    yield* http.post("/api/notify", $.object({
      to: email,              // lineage: db.users.email → response body
      company: enriched.company,  // lineage: api.clearbit → response body
    }));
  }),
);

// $.lineage(handler) → {
//   "email": db.users.email → http.post(/api/notify).body.to
//   "company": api.clearbit.company → http.post(/api/notify).body.company
// }
```

GDPR asks "where does this user's email go?" The macro answers that at compile time. Every proxy access is a link in the chain. Full directed graph from data sources to data sinks without runtime tracing.

### Taint Tracking / Information Flow

Mark values as tainted (user input, external data) and enforce sanitization before sensitive sinks:

```ts
const userId = req.params.id;  // auto-tainted: $.taint("user_input")

// ❌ compile error — tainted value flows directly into SQL
yield* db.query($.template`SELECT * FROM users WHERE id = ${userId}`);

// ✅ passes through sanitizer — taint cleared
const safeId = $.sanitize(userId, $.int());
yield* db.query($.template`SELECT * FROM users WHERE id = ${safeId}`);
```

The proxy tracks taint through every operation. `taintedValue.toString()` is still tainted. Only explicit sanitizers clear it. XSS, SQL injection, command injection — all caught at compile time.

### Reversibility / Saga Generation

Track which operations are reversible and auto-generate compensating transactions:

```ts
const transferFunds = yield* $.function("transferFunds").pipe(
  $.impl(function* ({ from, to, amount }) {
    yield* db.update("accounts", from, { balance: $.decrement(amount) });
    // ^ reverse = $.increment(amount)

    yield* db.update("accounts", to, { balance: $.increment(amount) });
    // ^ reverse = $.decrement(amount)

    yield* http.post("/api/ledger", $.object({ from, to, amount }));
    // ^ reverse = http.post("/api/ledger/void", ...) or IRREVERSIBLE
  }),
);

// Auto-generated: transferFunds_compensate — reverses in opposite order
// Or compile error: "step 3 is irreversible, cannot auto-generate compensation"
```

### Latency Bounds

Annotate effects with cost models. The macro computes worst-case latency through the call graph:

```ts
const db = yield* $.service("db").pipe($.latency({ p50: 2, p99: 15 }));
const http = yield* $.service("http").pipe($.latency({ p50: 50, p99: 200 }));

const handler = yield* $.function("handler").pipe(
  $.impl(function* ({ id }) {
    const user = yield* db.query(/*...*/);       // +15ms p99
    const posts = yield* db.query(/*...*/);       // +15ms p99 (sequential)
    const enriched = yield* http.get(/*...*/);    // +200ms p99
    return $.object({ user, posts, enriched });
  }),
);

// $.latency(handler) → { p50: 54, p99: 230 }
$.maxLatency({ p99: 100 })  // compile error: 230ms > 100ms
// Suggestion: "db.query calls are independent, wrap in $.parallel()"
```

### Cost in Dollars

```ts
const openai = yield* $.service("openai").pipe(
  $.cost({ perCall: 0.002, perInputToken: 0.00001, perOutputToken: 0.00003 }),
);

const processDocument = yield* $.function("processDocument").pipe(
  $.impl(function* ({ doc }) {
    const chunks = doc.split(/*...*/);
    const embeddings = yield* openai.embed(chunks);     // $0.002 × n chunks
    const summary = yield* openai.complete(doc);         // $0.002
    yield* db.write("summaries", summary);               // $0.000001
    return summary;
  }),
);

// $.cost(processDocument) → {
//   fixed: $0.002002,
//   perChunk: $0.002001,
//   estimate(chunks: 50): $0.102
// }
$.maxCost({ perInvocation: 0.05 })
// compile warning: "50+ chunks exceeds $0.05 budget"
```

### Blast Radius

How many downstream systems does a function touch?

```ts
// $.blastRadius(handleWebhook) → {
//   databases: ["profiles"],
//   externalAPIs: ["/api/cleanup", "/api/notify", "/api/enrich/*"],
//   effects: [DbRead, DbWrite, IO, Log],
//   downstreamFunctions: [getUser],
//   totalSystems: 5,
//   rating: "high"
// }
$.maxBlastRadius(3)  // compile error: touches 5 systems
```

### Secret Flow Analysis

```ts
const apiKey = yield* $.secret("API_KEY");

// ✅ secret flows into authorized sink
yield* http.post("/api/data", $.object({}), {
  headers: { authorization: apiKey }
});

// ❌ compile error — secret flows into log
yield* logger.info($.template`using key ${apiKey}`);

// ❌ compile error — secret flows into response body
return $.object({ key: apiKey, data: result });
```

Proxy traces secret-tagged values through every operation. If a secret reaches a non-whitelisted sink, compile error.

### Parallelizability Detection

```ts
const handler = yield* $.function("handler").pipe(
  $.impl(function* ({ userId }) {
    const user = yield* getUser(userId);
    const posts = yield* getPosts(userId);
    const notifications = yield* getNotifications(userId);
    return $.object({ user, posts, notifications });
  }),
);

// Macro detects: all three are independent
// Auto-rewrites to: const [user, posts, notifications] = await Promise.all([...])
// Or warns: "3 sequential independent effects, use $.parallel()"
```

### Cache-ability Analysis

```ts
// $.cacheability(getUser) → {
//   effects: [DbRead],
//   inputDeterministic: true,
//   cacheable: true,
//   invalidatedBy: [DbWrite("users")],
//   suggestedTTL: "until next db.write to users"
// }
```

Pure functions → infinite cache. Read-only → cacheable with known invalidation. Write effects → not cacheable. Macro can auto-wrap cacheable functions with memoization in generated output.

### Memory Pressure / Accumulation

```ts
const processBigFile = yield* $.function("processBigFile").pipe(
  $.impl(function* ({ lines }) {
    const results = [];
    yield* $.for(lines, function* (line) {
      const parsed = parseLine(line);
      results.push(parsed);  // accumulation detected
    });
    return results;
  }),
);

// $.memoryProfile(processBigFile) → {
//   accumulations: [{ var: "results", growth: "O(n)", inside: "loop over lines" }],
//   peakMemory: "O(n)",
//   suggestion: "consider streaming — yield results instead of accumulating"
// }
```

---

## 7. Why This Is Unprecedented

There is genuinely nothing like this in the JS/TS ecosystem — or arguably any mainstream ecosystem.

The closest comparisons all fall short:

- **Rust proc macros** — operate on token streams, not semantic IR. No effect tracking, no data flow, no proxy tracing. Just syntax → syntax.
- **Scala macros / Dotty** — type-aware but don't build a traceable IR you can walk and analyze before emission.
- **Lisp macros** — homoiconic so the structure is there, but untyped. No type-level complexity tracking, no effect inference.
- **Effect-ts / Koka / Eff** — track effects at runtime or in the type system, but can't act on that knowledge during codegen. They can't say "this function is O(n²), let me rewrite it."
- **Static analysis tools** (ESLint, SonarQube, CodeClimate) — work post-hoc on source text. They report. They can't transform.
- **Compiler passes** (GCC optimization levels, LLVM) — can analyze and transform, but you don't author code in the IR. The IR is hidden from the programmer.

ts-macros sits in a unique position: **you author in the IR, through proxies that feel like normal code, and the IR is fully inspectable and transformable before emission.** That combination doesn't exist anywhere else.

The proxy layer is what makes it unprecedented specifically. Without it, you have "a macro system with a nice IR" — powerful but niche. With proxies, you have a system where writing normal-looking TypeScript simultaneously builds a semantic graph that can be analyzed for cost, security, complexity, data lineage, parallelizability, cacheability, reversibility — all at compile time, all acting on the output, not just reporting.

**It's essentially: what if your programming language was also its own static analyzer, optimizer, and proof engine, and you didn't have to learn a separate tool for any of it?**
