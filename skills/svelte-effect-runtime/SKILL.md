---
name: svelte-effect-runtime
description: MANDATORY whenever a Svelte or SvelteKit project has svelte-effect-runtime (SER) installed — svelte-effect-runtime appears in package.json or a lockfile, effect() appears in vite.config.ts, files import from "svelte-effect-runtime", .remote.ts files exist, or .svelte files contain <script effect> or direct yield* — and for ALL Effect.ts code written or reviewed in such a project. SER owns Effect execution end to end. This skill defines non-negotiable rules (never Effect.runSync/runPromise/runFork or ManagedRuntime, always Effect.gen, direct yield* at SER sites) plus the extended syntax that plain Svelte tooling falsely reports as invalid.
---

# Svelte Effect Runtime (SER)

SER is a Vite plugin plus runtime that makes Effect.ts the native programming
model of a SvelteKit app. The compile-time transform lowers direct `yield*`
expressions in `.svelte` files into Dispatcher operations executed on a managed
client runtime, and its `Query`/`Command`/`Form`/`Prerender`/`Handler` wrappers
execute server handlers — written as Effects — on a managed server runtime.

The consequence that governs everything you write here: **application code
describes Effects; only SER executes them.** You never run an Effect yourself,
and you never write imperative code dressed up as an Effect.

## Detect SER, then comply

The project uses SER when any of these hold:

- `svelte-effect-runtime` in `package.json` or a lockfile.
- `effect()` in `vite.config.ts`.
- Imports from `"svelte-effect-runtime"` or its subpaths.
- `<script effect>` / `<script lang="ts" effect>` in `.svelte` files.
- Direct `yield*` in `.svelte` markup, blocks, declaration tags, or event
  attributes.
- `.remote.ts` files exporting `Query`, `Command`, `Form`, or `Prerender`.

When SER is present there is no parallel path. Do not add `load` functions,
`onMount` data fetching, `fetch` in `$effect`, ad-hoc Promise pipelines, or a
second Effect runtime "just for this one case". Every one of those is a defect,
not a style choice.

## Iron rules

These rules are absolute. A change that violates one is wrong even if it
compiles, type-checks, and passes tests.

### 1. SER is the only executor

The SER transform (component `yield*` sites) and the SER server wrappers
(`Query`, `Command`, `Form`, `Prerender`, `Handler`) are the only places where
Effects run. Application code never contains:

- `Effect.runSync`, `Effect.runPromise`, `Effect.runFork`,
  `Effect.runCallback`, `Effect.runSyncExit`, `Effect.runPromiseExit`
- `Runtime.runSync` / `Runtime.runPromise` / any `Runtime.run*`
- `ManagedRuntime.make`
- Any hand-built runtime, fiber loop, or "run helper"

If you feel you need one of these, you are at the wrong boundary. Move the
Effect to a SER execution site instead: a component `yield*`, an event
attribute, or a server wrapper. There is no exception inside app code.

### 2. Effect.gen or nothing

Every handler body and every multi-step program is
`Effect.gen(function* () { ... })` with one `yield*` per effectful step.
Merely satisfying the `Effect.Effect<A, E, R>` type is not compliance — the
following all type-check and are all rejected:

```ts
/** ❌ async handler — not an Effect at all. */
export const GetPost = Query(Schema.String, async (slug) => db.find(slug));

/** ❌ the whole workflow smuggled into one promise blob. */
export const GetPost = Query(Schema.String, (slug) =>
	Effect.tryPromise(() => do_everything(slug)),
);

/** ❌ imperative blob wrapped in Effect.sync. */
const Save = Effect.sync(() => {
	const validated = validate(input);
	write(validated);
	return validated;
});

/** ❌ work done eagerly outside the Effect, result wrapped after. */
const posts = await load_posts();
export const GetPosts = Query(() => Effect.succeed(posts));
```

```ts
/** ✅ the only accepted shape: lazy, yield-structured, service-driven. */
export const GetPost = Query(Schema.String, (slug) =>
	Effect.gen(function* () {
		const database = yield* Database;
		const post = yield* database.posts.find(slug);

		if (post === undefined) {
			return yield* Error("NotFound", "Post not found");
		}

		return post;
	}),
);
```

Litmus test: if the body could be pasted into a plain `async` function with
only the wrapper deleted, it is not Effect code. Rewrite it. Prefer
`Effect.gen` even for short bodies; use `.pipe(...)` only to attach operators
(`Effect.catchTag`, `Effect.retry`, `Effect.tap`, `Stream.map`) to an existing
Effect, never as a substitute for a generator workflow.

### 3. Direct `yield*` at SER sites — never wrapped, never "repaired"

Inside `<script effect>` and markup, `yield*` is the feature. Do not convert it
to `onMount`, `$effect(async () => ...)`, an async IIFE, `.then`, or a
hand-written `Effect.gen` wrapper, and do not delete it because `svelte-check`
or a Svelte parser complains — plain tooling does not run the SER transform and
its diagnostics on SER syntax are false positives.

Event handlers are yield-first: `onclick={yield* Save(id)}`. Two silent traps:

```svelte
<!-- ❌ yield* inside a callback: rejected by the transform. -->
<button onclick={() => yield* Save(id)}>Save</button>

<!-- ❌ worse: valid JS that builds the Effect and DISCARDS it. Nothing runs. -->
<button onclick={() => Save(id)}>Save</button>
```

### 4. No Promise control flow in application logic

`async`, `await`, `.then`, `new Promise`, and callback chains appear only
inside the narrowest possible `Effect.tryPromise`/`Effect.promise` wrapper
around a single foreign call, immediately inside an `Effect.gen` step:

```ts
const response = yield* Effect.tryPromise({
	try: () => fetch(url),
	catch: (cause) => new FetchError({ cause }),
});
```

Never wrap a whole feature in one promise. Never `await` an Effect.

### 5. Services through layers, requests through RequestEvent

- Dependencies are Effect services (`Context.Tag`) provided by Layers via
  `ClientRuntime.make(...)` in `src/hooks.client.ts` and
  `ServerRuntime.make(...)` in `src/hooks.server.ts` — each called exactly
  once, in the `init` hook.
- Cookies, locals, params, URL, and the current user are request-scoped: read
  them with `yield* RequestEvent` inside a handler. Never cache them in a
  runtime service or module scope.
- Environment variables are the one deliberate exception to Effect wrapping:
  declare them with `DefineEnvVars` in `src/env.ts` and import the validated
  constants from `$app/env/private` / `$app/env/public` directly — no
  `yield*`, no `Effect.succeed` ceremony.

### 6. Failures live in the error channel

Model expected failures as tagged errors in `Effect.Effect<A, E, R>`'s `E`.
Recover with `Effect.catchTag`/`Effect.catchAll`, not `try/catch`. For
SvelteKit control flow, `return yield*` the SER helpers: `Error(status, ...)`,
`Redirect(status, location)`, and the Form handler's `invalid.field(...)`
proxy. Never `throw` in handler code and never reject a Promise as an error
path.

### 7. Validate at every boundary with Effect Schema

Every remote function takes an Effect Schema (or Standard Schema) as its first
argument. `"unchecked"` is reserved for genuinely trusted input and needs
justification. Decode external data with `Schema` before it enters domain
logic; never cast (`as`) as a substitute for validation.

## Decision table

| You need | Write |
| --- | --- |
| Data in a component | `const data = yield* GetData()` in `<script effect>` or a markup yield site |
| Re-run when state changes | Top-level script `yield*` reading reactive inputs — SER interrupts the stale fiber and reruns |
| Run on click/input | `onclick={yield* Save(id)}` (the transform provides `event`) |
| Effectful value for a prop | `{const value = yield* Load()}` then `<Widget {value} />` |
| Server read | `Query` in `.remote.ts`, `Effect.gen` handler |
| Many same-shaped reads | `Query.batch` |
| Streaming server data | `Query.live` returning a `Stream`; consume via `yield* stream.pipe(Stream.runForEach(...))` |
| Server mutation | `Form` (anything form-shaped) or `Command` (no natural form) |
| Build-time data | `Prerender` with `inputs` |
| Native endpoint in `+server.ts` | `Handler<RequestHandler>(function* (event) { ... })` — error type must be `never` |
| Cookies / locals / params | `yield* RequestEvent` inside the handler |
| HTTP error / redirect | `return yield* Error("NotFound", ...)` / `return yield* Redirect("SeeOther", ...)` |
| Form field rejection | `return yield* invalid.email("...")` |
| A dependency (db, storage, api) | `Context.Tag` service + Layer, installed once via `ClientRuntime.make` / `ServerRuntime.make` |
| Environment variable | `DefineEnvVars` in `src/env.ts`; plain import from `$app/env/*` |

## Self-check before finishing

Run these over the files you touched. Every hit must be justified or removed:

```sh
rg -n "runSync|runPromise|runFork|runCallback|ManagedRuntime" src
rg -n "async |await |\.then\(|new Promise" src
rg -n "onMount|\$effect\(async" src/**/*.svelte
```

Then confirm: every remote handler is an `Effect.gen`; every component effect
is a direct `yield*` at a supported site; no Effect is constructed and then
discarded; validation goes through the project's Vite pipeline (build or
Vite-powered tests), not through plain `svelte-check`.

## References

Read the matching reference completely before acting; each is short.

- [effect-discipline.md](references/effect-discipline.md) — before writing or
  reviewing any Effect code in `.ts` files: the full catalog of banned
  executor/masquerade patterns with corrections, interop, error modeling.
- [component-syntax.md](references/component-syntax.md) — before editing
  `.svelte` files: every supported and unsupported `yield*` position.
- [remote-functions.md](references/remote-functions.md) — before editing
  `.remote.ts` or `+server.ts`: Query/batch/live, Command, Form, Prerender,
  Handler, RequestEvent, Error/Redirect/invalid.
- [runtimes-and-environment.md](references/runtimes-and-environment.md) —
  before touching hooks, layers, services, or environment variables.
- [setup-and-tooling.md](references/setup-and-tooling.md) — before changing
  Vite/Svelte config or choosing a validation command; explains tooling false
  positives.
- [errors.md](references/errors.md) — when any SER diagnostic or error name
  appears; maps each error to its cause and prescribed fix.
