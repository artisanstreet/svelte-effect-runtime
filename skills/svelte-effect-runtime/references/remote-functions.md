# Remote Functions

SER wraps SvelteKit remote functions so server handlers are Effects and
client call sites are yieldable. Handlers execute on `ServerRuntime`; the
current request is available as the `RequestEvent` service.

Placement is load-bearing: declare remote functions in `*.remote.ts` files
(and native handlers in `+server.ts`, hooks in `hooks.server.ts`,
server modules in `*.server.ts`). SER's import rewrite only recognizes those
naming conventions — a server export invoked from an unrecognized file throws
`ServerOnlyImportError`. Import everything from `"svelte-effect-runtime"`;
the compiler rewrites server imports.

Choosing the wrapper:

- `Query` — read-only data. Keep it side-effect free; SER cannot check this.
- `Query.batch` — many same-shaped reads collected into one transport call.
- `Query.live` — server-pushed stream of values.
- `Form` — any mutation with a natural HTML form. Prefer this over `Command`:
  it works without JavaScript and enhances progressively.
- `Command` — mutations with no natural form (buttons, menus, pipelines).
- `Prerender` — data resolvable at build time.
- `Handler` — native `+server.ts` HTTP endpoints as Effects.

Every handler body is `Effect.gen` (or a `Stream` for `Query.live`). Never an
async function; never a promise blob. See effect-discipline.md.

## Query

```ts
import { Effect, Schema } from "effect";
import { Error, Query } from "svelte-effect-runtime";
import { Database } from "$lib/server/database";

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

Validator forms: an Effect Schema (converted at the boundary), a Standard
Schema, `"unchecked"` (input typed as-sent, no validation — trusted input
only), or no first argument for an inputless query.

### Calling from a component

```svelte
<script lang="ts" effect>
	import { GetPost } from "./post.remote";

	const post = yield* GetPost("hello-world");
</script>

<h1>{post.title}</h1>
```

Calling a query returns a value that is both an Effect (yield it for the
data) and a resource with reactive fields — usable without yielding:

```svelte
<script lang="ts" effect>
	const post = GetPost("hello-world");
</script>

{#if post.ready}
	<h1>{post.current.title}</h1>
{:else if post.loading}
	<p>Loading…</p>
{/if}
```

- `current` — last successful value (or `undefined`); `loading`, `ready`,
  `error`; `refresh()` — an Effect forcing a refetch:
  `<button onclick={yield* GetPosts().refresh()}>`.
- SvelteKit deduplicates by serialized argument: same args share cache and
  in-flight work. But each call returns a fresh wrapper —
  `GetPosts() !== GetPosts()`; never compare call results with `===`.

## Query.batch

Handler receives all collected inputs and returns a resolver
`(input, index) => output`:

```ts
export const GetWeather = Query.batch(Schema.String, (city_ids) =>
	Effect.gen(function* () {
		const database = yield* Database;
		const rows = yield* database.weather.for_cities(city_ids);
		const by_id = new Map(rows.map((row) => [row.city_id, row]));

		return (city_id) => by_id.get(city_id) ?? null;
	}),
);
```

Batching affects transport only; each caller receives its own result.

## Query.live

The handler must return Effect's `Stream.Stream<A, E, R>` **directly** — not
a value, not a Promise, not an iterable, not `Effect.succeed(stream)`.
Anything else throws `InvalidLiveQueryReturnError`. Wrap native sources with
`Stream.fromIterable` / `Stream.fromAsyncIterable` first.

```ts
import { Stream } from "effect";
import { Query } from "svelte-effect-runtime";

export const Clock = Query.live(
	Stream.tick("1 second").pipe(Stream.map(() => new Date().toISOString())),
);
```

Client side, calling the export returns a `RemoteLiveStream` — the stream
itself, with hidden transport metadata:

```svelte
<script lang="ts" effect>
	import { Effect, Stream } from "effect";
	import { Live } from "svelte-effect-runtime";
	import { Clock } from "./time.remote";

	let time = $state("Connecting...");
	const clock = Clock();

	yield* clock.pipe(
		Stream.runForEach((next) => Effect.sync(() => { time = next; })),
	);
</script>

<p>{time}</p>
<button onclick={yield* Live.reconnect(clock)}>Reconnect</button>
```

- A direct `yield* clock` reads only the **first** element, then stops; if
  the stream completes without emitting it fails with `EmptyStreamYieldError`.
  Use `Stream.runForEach` for continuous consumption.
- Stream operators (`Stream.map`, `Stream.filter`, `Stream.retry(...)`)
  preserve the transport metadata, so `Live.status(derived)` (states
  `"Connecting" | "Open" | "Failed" | "Closed"`) and
  `Live.reconnect(derived)` (an Effect — yield it) keep working. A plain
  Stream cast to the remote type has no metadata and `Live.reconnect` fails.
- There is no resource API on live queries (no `.current`/`.ready` — that
  was pre-4.0). Copy elements into `$state` via `Stream.runForEach`.
- Unmount or a changed tracked dependency interrupts the consumer and closes
  the upstream iterator.

## Command

```ts
import { Effect, Schema } from "effect";
import { Command } from "svelte-effect-runtime";

const ArchiveProjectInput = Schema.Struct({ project_id: Schema.String });

export const ArchiveProject = Command(ArchiveProjectInput, ({ project_id }) =>
	Effect.gen(function* () {
		const projects = yield* ProjectRepository;
		yield* projects.archive(project_id);

		return { project_id, archived: true };
	}),
);
```

```svelte
<button
	disabled={ArchiveProject.pending > 0}
	onclick={yield* ArchiveProject({ project_id })}
>
	{ArchiveProject.pending > 0 ? "Archiving..." : "Archive"}
</button>
```

`pending` counts in-flight calls. **Calling a command only creates an
Effect** — a discarded call (`onclick={() => ArchiveProject(...)}`) executes
nothing. Yield it at a SER site or compose it into a yielded program.

Recover expected failures in-channel before the site that yields:

```svelte
<script lang="ts" effect>
	import { Effect } from "effect";
	import { ArchiveProject } from "./projects.remote";

	let message = $state("");

	const archive = (project_id: string) =>
		ArchiveProject({ project_id }).pipe(
			Effect.tap(() => Effect.sync(() => { message = "Archived"; })),
			Effect.catchAll(() => Effect.sync(() => { message = "Could not archive"; })),
		);
</script>

<button onclick={yield* archive("p_123")}>Archive</button>
```

## Form

```ts
import { Effect, Schema } from "effect";
import { Form } from "svelte-effect-runtime";

const ProfileInput = Schema.Struct({
	name: Schema.String,
	email: Schema.String,
});

export const UpdateProfile = Form(ProfileInput, ({ data, invalid }) =>
	Effect.gen(function* () {
		if (data.name.trim().length === 0) {
			return yield* invalid.name("Name is required");
		}

		const profiles = yield* ProfileRepository;
		return yield* profiles.update(data);
	}),
);
```

```svelte
<script lang="ts">
	import { UpdateProfile } from "./profile.remote";
</script>

<form {...UpdateProfile}>
	<label>Name <input name="name" autocomplete="name" /></label>
	<label>Email <input name="email" type="email" autocomplete="email" /></label>
	<button>Save profile</button>
</form>
```

- The handler must be correct without client JavaScript; enhancement is
  additive.
- Schema validation runs before the handler. The `invalid` proxy is for
  business rules needing server context (uniqueness, permissions,
  cross-field). Paths mirror the input shape and are fully typed:
  `invalid.email("...")`, `invalid.items[0]!.label("...")`,
  `invalid("whole-form message")`. Each produces an Effect failing with a
  typed `FormError` — always `return yield*` it.
- Programmatic submission: `yield* UpdateProfile.submit({ name, email })`.
  Also effect-aware: `validate()`, `preflight(schema)`, `enhance(callback)`
  (callback may return an Effect), `for(id)` for stable instances.
- On the client, rejected input surfaces as `RemoteValidationError`
  (recover with `Effect.catchTag("RemoteValidationError", ...)`).

## Prerender

```ts
import { Effect, Schema } from "effect";
import { Prerender } from "svelte-effect-runtime";

export const GetDocsIndex = Prerender(
	Schema.String,
	(section) =>
		Effect.gen(function* () {
			const docs = yield* DocsRepository;
			return yield* docs.index(section);
		}),
	{ inputs: () => ["ser", "effect"] },
);
```

- `inputs` lists the build-resolved arguments; keep them finite.
- `dynamic: true` only when a missing input is genuinely safe to resolve on
  demand — not as a way to smuggle request-time behavior (use `Query`).
- Runs on `ServerRuntime` at build time: layer services must be available in
  the build environment; unrecovered failure fails the build.
- No cookies, locals, user-specific or rapidly changing data.

## Handler (+server.ts)

Native endpoints as Effects. Pass the route-local type; write a generator:

```ts
import type { RequestHandler } from "./$types";
import { Effect } from "effect";
import { Error, Handler, Redirect } from "svelte-effect-runtime";
import { GetAccount } from "$lib/server/accounts";

export const GET = Handler<RequestHandler>(function* ({ locals }) {
	if (!locals.user) {
		return yield* Redirect("SeeOther", "/sign-in");
	}

	const account = yield* GetAccount(locals.user.id).pipe(
		Effect.catchTag("AccountNotFound", () => Error("NotFound", "Account not found")),
	);

	return Response.json(account);
});
```

- Succeeds with a `Response`; the error type must be `never` — recover every
  domain failure or translate it via `Error`/`Redirect` before returning.
- One HTTP method per `Handler`; it does not wrap `Actions`.
- Runs on `ServerRuntime` with `RequestEvent` provided; the request's abort
  signal interrupts the Effect.
- Do not wrap `load` functions with `Handler` for page data — call a `Query`
  from an `effect` script instead.

## RequestEvent

The current SvelteKit request as an Effect service: `cookies`,
`getClientAddress`, `locals`, `params`, `platform`, `request`, `route`,
`url`.

```ts
import { Effect } from "effect";
import { Command, RequestEvent } from "svelte-effect-runtime";

export const SignOut = Command(
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		event.cookies.delete("session", { path: "/" });
	}),
);
```

- Any Effect reached from a handler inherits the request context — helpers
  can `yield* RequestEvent` without threading the event through arguments.
- Only available while SER runs a handler; module init, runtime startup, or
  detached work throws `RequestEventUnavailableError`.
- Never cache the event or copy request values into runtime services or
  module scope: concurrent requests share the runtime, not the event.

## Error and Redirect

Effect versions of SvelteKit's control-flow helpers. Both never succeed —
SvelteKit takes over the request. Always `return yield*` them.

```ts
return yield* Error("NotFound", "Post not found");            // = Error(404, ...)
return yield* Error("NotFound", "Post not found", { code: "POST_NOT_FOUND" });
return yield* Redirect("SeeOther", "/drafts");                // = Redirect(303, ...)
return yield* Redirect("TemporaryRedirect", payment_url, {
	external: ["https://checkout.example.com"],                // SvelteKit 3 external opt-in
});
```

Use typed effect failures for domain cases the client recovers from; use
`Error`/`Redirect` when SvelteKit should own the HTTP outcome. `Error`
shadows the global constructor — alias when a module needs both:
`import { Error as HttpError } from "svelte-effect-runtime"`.
