# Runtimes, Services, and Environment

An Effect describes its work and the services it needs; a runtime supplies
those services and executes the program. SER keeps two managed runtimes and
they are the only two that exist:

```text
Svelte component -> ClientRuntime -> browser services
Remote handler   -> ServerRuntime -> server services
```

Never create a third (`ManagedRuntime.make`, hand-rolled runtimes). Never
provide a server service to the client runtime — anything given to browser
code can enter the client bundle.

## Defaults and initialization

Both runtimes are optional. SER lazily creates an empty runtime when the
first effect needs no custom service — pure effects and plain remote calls
work with zero setup. Configure a runtime only when effects start yielding a
custom service.

Configure once, in the `init` hook, before any component or handler runs:

```ts
// src/hooks.client.ts
import { ClientRuntime } from "svelte-effect-runtime";
import { BrowserServicesLive } from "$lib/client/services";

export const init = () => {
	ClientRuntime.make(BrowserServicesLive);
};
```

```ts
// src/hooks.server.ts
import { Layer } from "effect";
import { ServerRuntime } from "svelte-effect-runtime";
import { DatabaseLive } from "$lib/server/database";
import { LoggerLive } from "$lib/server/logger";

export const init = () => {
	ServerRuntime.make(Layer.mergeAll(DatabaseLive, LoggerLive));
};
```

Rules:

- `make(...)` is the one sanctioned startup side effect; the `init` hook is
  its one sanctioned home. Never call it in a component, module scope of app
  code, or after work has begun.
- A second `make` throws `RuntimeAlreadyInitializedError` — and the first
  runtime may have been installed lazily, so late configuration can fail even
  without an explicit earlier call. Exception: Vite dev SSR disposes the old
  server runtime on HMR so an edited `hooks.server.ts` can re-init.
- `make` does not block `init` while layers start; other initialization
  proceeds.

## Defining services

Model capabilities as `Context.Tag` services with live Layers; construction
lives in the Layer, consumers only yield the tag:

```ts
import { Context, Effect, Layer } from "effect";

export class BrowserStorage extends Context.Tag("BrowserStorage")<
	BrowserStorage,
	{
		readonly get: (key: string) => Effect.Effect<string | null>;
		readonly set: (key: string, value: string) => Effect.Effect<void>;
	}
>() {}

export const BrowserStorageLive = Layer.succeed(BrowserStorage, {
	get: (key) => Effect.sync(() => localStorage.getItem(key)),
	set: (key, value) => Effect.sync(() => localStorage.setItem(key, value)),
});
```

```svelte
<script lang="ts" effect>
	import { BrowserStorage } from "$lib/client/browser-storage";

	const storage = yield* BrowserStorage;
	let theme = $state((yield* storage.get("theme")) ?? "system");

	const save_theme = (next: string) => storage.set("theme", next);
</script>

<button onclick={yield* save_theme("dark")}>Use dark theme</button>
```

- Combine independent services with `Layer.mergeAll(...)`.
- Server layers are long-lived and shared across concurrent requests — every
  service must be concurrency-safe.
- Resource-owning services express acquire/release through scoped effects and
  layers; SER interrupts component fibers on destroy and runs finalizers.
- Handlers describe request work; they never open connections or rebuild
  clients per call — that construction belongs in the Layer.

## Global vs request-scoped

Runtime layers hold global capabilities: database pools, API clients,
loggers, queues, feature flags, storage.

Cookies, locals, params, URL, and the current user belong to one request.
Read them via `yield* RequestEvent` inside the handler (or any Effect it
calls). Storing request data in a runtime service or module scope leaks one
request's data into another.

## Environment variables

Declare SvelteKit explicit env vars with Effect Schema in `src/env.ts` via
`DefineEnvVars` (requires SER 4.2.0 + SvelteKit 3 explicit env):

```ts
import { DefineEnvVars } from "svelte-effect-runtime";
import { Schema } from "effect";

export const variables = DefineEnvVars({
	PORT: {
		schema: Schema.NumberFromString,
		description: "Port used by the server.",
	},
	DATABASE_URL: {
		schema: Schema.RedactedFromValue(Schema.String),
	},
	PUBLIC_ORIGIN: {
		public: true,
		static: true,
		schema: Schema.URLFromString,
	},
});
```

- Fields pass through to SvelteKit unchanged: `public` (expose via
  `$app/env/public`), `static` (inline at build), `description` (editor
  hover), `schema` (Effect Schema or Standard Schema; schema-less keeps
  SvelteKit's non-empty-string default).
- Schemas must decode synchronously from the raw string.
- Consume as plain imports — validated once at startup, so the exports are
  ordinary constants. **Do not wrap them in Effects**; `Effect.succeed(PORT)`
  is ceremony without semantics:

```ts
import { DATABASE_URL, PORT } from "$app/env/private";
import { Redacted } from "effect";

export const connect = () =>
	open_pool({ port: PORT, url: Redacted.value(DATABASE_URL) });
```

- Secrets: declare with `Schema.RedactedFromValue(...)` so the value arrives
  wrapped and prints as `<redacted>`; unwrap explicitly with
  `Redacted.value(...)`. SvelteKit keeps the server-only import guard —
  importing `$app/env/private` from browser code fails the build.
