# examples/sveltekit

A running gallery of `svelte-effect-runtime` features wired into a real
SvelteKit app. Every remote-function kind — `Form`, `Query`, `Command`,
`Prerender` — has its own group of routes, accessible from a persistent
left sidebar.

## Run

```sh
cd examples/sveltekit
npm install
npm run dev
```

Then open the URL Vite prints.

The app installs SER from npm (`svelte-effect-runtime@^1.5.0`); it does
not depend on the workspace build. Bump the dep in `package.json` to
try a newer SER release.

## What it covers

| Group | Routes | What's exercised |
| --- | --- | --- |
| **Form** | basic-spread, programmatic, for-loop, enhance, validation, unchecked, no-input, effect-pipe, descriptor | The 1.5.0 form-spread fix; `<form {...formObj}>`, `.submit()` as Effect, `.for(id)` per-row instances, `.enhance(cb)`, validation issues, descriptor diagnostics |
| **Query** | basic, schema, unchecked, error-handling | No-arg, schema-validated, "unchecked", and `Data.TaggedError` recovery via `Effect.catchTag` |
| **Command** | basic, void, pending, error-handling | Schema-validated, void input, `.pending` aggregation, tagged-error recovery |
| **Prerender** | basic, dynamic | Build-time inputs generator vs. `dynamic: true` runtime refresh |

## Best practices the gallery teaches

- **Domain errors live in [`src/lib/errors.ts`](src/lib/errors.ts) as
  `Data.TaggedError("Tag")<Fields>` classes.** They serialise through
  SER's wire transport with the tag intact, so the client can
  `Effect.catchTag("Tag", err => ...)` and get typed field access.
- **`<form {...form}>` is bit-identical to SvelteKit's native form.**
  The 1.5.0 fix made this so. The `/form/descriptor` route prints the
  enumerable own keys, the `@attach` symbol, and per-key descriptors
  for you to verify.
- **`submit(data)` is the Effect.** `EffectForm` stays a spreadable
  form object; `submit()` is where the typing converts to
  `Effect<Output, RemoteFailure<Error>, never>` and every Effect
  operator (`pipe`, `matchCause`, `catchTag`, `tap`, …) works as you
  would expect.
- **`yield*` lives at top level of `<script effect>`, inside
  `Effect.gen`, or in inline arrow event handlers.** It does *not*
  work inside `function` declarations — the preprocessor only rewrites
  the first set of positions. The pages use the inline-arrow pattern
  consistently.
