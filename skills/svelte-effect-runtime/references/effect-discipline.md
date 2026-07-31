# Effect Discipline in SER Projects

Read this before writing or reviewing any Effect code in a SER project. The
rules here are strict on purpose: SER apps fail in production when Effect code
is imitated rather than written.

## The contract

An Effect is a lazy description of work. SER's transform and server wrappers
are the only executors of those descriptions. Application code therefore has
exactly two jobs:

1. **Describe** work as Effects — `Effect.gen` programs composed of `yield*`
   steps, services, schemas, and typed errors.
2. **Hand** those descriptions to a SER execution site — a component `yield*`,
   an event attribute, or `Query`/`Command`/`Form`/`Prerender`/`Handler`.

Anything else — running, awaiting, or eagerly evaluating — is a violation.

## Banned: running Effects yourself

Never write any of these in application code:

| Banned | Why | Instead |
| --- | --- | --- |
| `Effect.runPromise(program)` | Detaches the fiber from SER's lifecycle: no interruption on destroy, no services, no request scope | `yield* program` at a SER site |
| `Effect.runSync(program)` | Same, and throws on any async step | `yield* program` |
| `Effect.runFork` / `runCallback` / `run*Exit` | Same | `yield* program`, or `Effect.fork` *inside* a program when concurrency is really needed |
| `ManagedRuntime.make(layer)` | Creates a second runtime competing with SER's; services diverge, cleanup never runs | `ClientRuntime.make` / `ServerRuntime.make` once in hooks `init` |
| `Runtime.runPromise(rt)(program)` | Same | Same |

The temptation to run an Effect always means the code sits at the wrong
boundary. Relocate it:

- Value needed during render → component `yield*` (script or markup site).
- Work on user interaction → `onclick={yield* Save(id)}`.
- Work in `$effect` / `$derived.by` → these callbacks are synchronous by
  Svelte contract and can never run Effects. Restructure: a top-level script
  `yield*` that reads the reactive inputs reruns automatically when they
  change (the Dispatcher interrupts the stale fiber first).
- Server-side execution → the handler already runs on `ServerRuntime`; return
  the Effect and stop.
- Fire-and-forget → does not exist. Every Effect is yielded at a site that
  owns its lifecycle.

## Banned: plain TypeScript wearing the Effect type

`Effect.Effect<A, E, R>` is easy to satisfy without writing Effect code. All
of the following type-check; all are rejected in review:

### The async handler

```ts
/** ❌ Not an Effect. Loses typed errors, interruption, services. */
export const GetPosts = Query(async () => db.posts.list());
```

### The promise blob

```ts
/** ❌ One giant tryPromise wrapping the whole workflow. */
export const SaveOrder = Command(OrderSchema, (order) =>
	Effect.tryPromise(async () => {
		const user = await get_user();
		await check_stock(order);
		return await write_order(user, order);
	}),
);
```

Every step is invisible to Effect: no per-step errors, no interruption
between steps, no service access, no retry granularity.

### The sync blob

```ts
/** ❌ Imperative body wrapped once at the end. */
const Recalculate = Effect.sync(() => {
	const rows = read_cache();
	const totals = rows.map(compute_total);
	write_cache(totals);
	return totals;
});
```

### Eager work, wrapped result

```ts
/** ❌ The work already happened during module evaluation. */
const config = load_config_sync();
export const GetConfig = Query(() => Effect.succeed(config));
```

`Effect.succeed(x)` evaluates `x` immediately. If `x` is the result of work,
the Effect describes nothing.

### The correct shape — always

```ts
export const SaveOrder = Command(OrderSchema, (order) =>
	Effect.gen(function* () {
		const users = yield* UserRepository;
		const stock = yield* StockService;

		const user = yield* users.current();
		yield* stock.reserve(order);

		return yield* users.write_order(user, order);
	}),
);
```

One `yield*` per effectful step. Dependencies as services. Failures in the
error channel. Nothing runs until SER runs it.

## Effect.gen first, pipe second

Default every program body to `Effect.gen(function* () { ... })`. Define
Effect-returning operations as arrow functions returning `Effect.gen`;
never a `function` declaration whose body merely returns `Effect.gen`.

`.pipe(...)` is for attaching operators to an existing Effect — recovery,
retry, instrumentation, transformation:

```ts
const archive = (project_id: string) =>
	ArchiveProject({ project_id }).pipe(
		Effect.tap(() => Effect.sync(() => { message = "Archived"; })),
		Effect.catchTag("RemoteValidationError", () =>
			Effect.sync(() => { message = "Could not archive"; }),
		),
	);
```

Do not build workflows out of chained `Effect.flatMap`/`Effect.map` when a
generator states the same steps as a readable sequence. Do not use `Effect.andThen`
chains as an async/await substitute. If the logic has more than one step,
it is a generator.

## Promise interop: smallest possible surface

When a dependency only speaks Promises, wrap the single foreign call — not
the workflow around it — and give the failure a tagged type:

```ts
import { Data, Effect } from "effect";

class GeoLookupError extends Data.TaggedError("GeoLookupError")<{
	readonly cause: unknown;
}> {}

const Locate = (query: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () => fetch(`/geo?q=${encodeURIComponent(query)}`),
			catch: (cause) => new GeoLookupError({ cause }),
		});

		return yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (cause) => new GeoLookupError({ cause }),
		});
	});
```

Rules:

- `await` never appears outside a `try:` callback.
- `Effect.promise` only for calls that genuinely cannot fail; otherwise
  `Effect.tryPromise` with a tagged `catch`.
- Better: hide the interop inside a service's live Layer so domain code never
  sees a Promise at all.
- Never mix `await` and `yield*` in one statement — in components SER rejects
  it outright (`AwaitInEffectWorkError`).

## Failures: typed, tagged, recovered in-channel

- Expected failures are `Data.TaggedError` classes (or tagged data) in the
  Effect's `E`. Never `throw` inside a generator; never encode failure as
  `null`/`undefined`/boolean sentinels.
- Recover with `Effect.catchTag` / `Effect.catchTags` / `Effect.catchAll` —
  never `try/catch` around `yield*`.
- SvelteKit control flow from server handlers: `return yield* Error("NotFound", ...)`,
  `return yield* Redirect("SeeOther", "/target")`, and in Forms
  `return yield* invalid.field("message")`. These Effects never succeed;
  always `return yield*` them.
- Remote calls fail on the client with tagged data you can match:
  `RemoteValidationError`, `RemoteHttpError`, `RemoteTransportError` — plus
  your own domain tags, which cross the wire typed. Handle them with
  `Effect.catchTag("RemoteValidationError", ...)` etc.

## Modeling and data

- Absence and alternatives are ADTs: `Option`, `Either`, tagged unions —
  not `A | null | undefined`.
- Every boundary decodes with Effect Schema before data enters domain logic.
  Type assertions (`as`) are not validation.
- Dependencies are `Context.Tag` services provided by Layers; construction
  lives in the Layer, handlers only `yield*` the service.
- Resource lifetimes use scoped Effects/Layers (`Effect.acquireRelease`,
  `Layer.scoped`), never manual open/close pairs.
- Use Effect's own retry, timeout, concurrency, scheduling, and caching
  operators instead of reimplementing them with timers and flags.

## Review checklist

Reject the diff when any of these is true:

- [ ] Any `run*` executor or `ManagedRuntime` in app code.
- [ ] Any `async`/`await`/`.then`/`new Promise` outside a minimal
      `tryPromise`/`promise` wrapper.
- [ ] Any handler whose body is not `Effect.gen` (or a `Stream` for
      `Query.live`, or a single pre-built Effect being reused).
- [ ] Work performed during construction (`Effect.succeed(do_work())`,
      module-level side effects).
- [ ] An Effect constructed and then discarded — a call like `Save(id)` whose
      result is neither yielded nor composed executes nothing, silently.
- [ ] `try/catch` or thrown exceptions where the error channel belongs.
- [ ] Request data (cookies, locals, user) cached in module scope or a
      runtime service instead of `yield* RequestEvent`.
- [ ] `"unchecked"` used where a schema could exist.
