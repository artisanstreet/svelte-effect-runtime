# Runtime And Server Boundaries

SER has separate browser and server runtime concerns. Do not move server work
into components just because component `yield*` is available.

## Client Runtime

Component effects run in the browser runtime. The default empty runtime is
enough for pure examples.

Use `ClientRuntime.make(...)` in `src/hooks.client.ts` when component effects
need browser-side services such as storage, analytics, clocks, feature flags, or
client APIs.

```ts
import { ClientRuntime } from "svelte-effect-runtime";
import { BrowserStorageLive } from "$lib/services/browser-storage";

export const init = () => {
  ClientRuntime.make(BrowserStorageLive);
};
```

## Server Runtime

Remote handlers run in the server runtime. The default empty runtime is enough
for pure `Effect.succeed` examples.

Use `ServerRuntime.make(...)` in `src/hooks.server.ts` for long-lived server
services such as database pools, loggers, auth clients, and queues.

```ts
import { ServerRuntime } from "svelte-effect-runtime/server";
import { DatabaseLive } from "$lib/server/database";

export const init = () => {
  ServerRuntime.make(DatabaseLive);
};
```

Keep request-scoped data out of singleton runtime services. Use `RequestEvent`
inside remote handlers for cookies, locals, params, and request-specific data.

## Remote Functions

Import remote function builders from `"svelte-effect-runtime/server"`.

- Use `Query` for server reads.
- Use `Query.batch` for many same-kind reads discovered during render.
- Use `Query.live` for streamed server data.
- Use `Command` for mutations from buttons, menus, and effects.
- Use `Form` for progressive form submissions and validation errors.
- Use `Prerender` for build-time or static data with optional dynamic fallback.

```ts
import { Query } from "svelte-effect-runtime/server";
import { Effect, Schema } from "effect";

export const get_count = Query(Schema.Struct({ key: Schema.String }), ({ key }) =>
  Effect.succeed({ key, value: 1 }),
);
```

Client components can yield remote calls through SER syntax:

```svelte
<script lang="ts" effect>
  import { get_count } from "./counter.remote";

  const count = get_count({ key: "visits" });
</script>

{#await yield* count}
  <p>Loading</p>
{:then result}
  <p>{result.value}</p>
{/await}
```

## Environment Variables

Declare SvelteKit explicit environment variables in `src/env.ts` with
`DefineEnvVars` from `"svelte-effect-runtime/environment"` (also exported from
the root). It is a thin wrapper over SvelteKit's `defineEnvVars` that accepts
Effect Schemas and converts them to Standard Schemas; SvelteKit keeps loading,
visibility, validation, and the server-only import guard.

```ts
import { DefineEnvVars } from "svelte-effect-runtime/environment";
import { Schema } from "effect";

export const variables = DefineEnvVars({
  PORT: { schema: Schema.NumberFromString, description: "Server port." },
  PUBLIC_ORIGIN: { public: true, schema: Schema.URLFromString },
});
```

Consume decoded values as plain imports from `$app/env/private` or
`$app/env/public`. Do not wrap them in Effects; validated constants are used
directly inside effect code. Schemas must decode synchronously, and a schema
may output `Redacted` values for private secrets.
