# Query.live stream-native redesign

## Goal

`Query.live` should expose Effect streams directly instead of mixing a live
transport resource with cached query methods. The server handler returns a
`Stream.Stream`, the client receives a branded `RemoteLiveStream`, and transport
controls live in the `Live` helper.

## Public API

```ts
import { Live } from "svelte-effect-runtime";
import { Query } from "svelte-effect-runtime/server";
import { Effect, Stream } from "effect";

export const Clock = Query.live(Stream.repeatEffect(Effect.succeed(new Date().toISOString())));
```

```svelte
<script lang="ts">
  import { Clock } from "./clock.remote";
  import { Live } from "svelte-effect-runtime";

  const clock = Clock();
  const status = Live.status(clock);
</script>

<p>{yield* clock}</p>
```

- `Query.live(stream)` is valid for no-input live queries.
- `Query.live(schema, (input) => stream)` is valid for input-bearing live
  queries.
- `Query.live(schema, stream)` is intentionally rejected because an input schema
  needs an input-aware stream factory.
- `Live.status(stream)` returns transport state for a `RemoteLiveStream`.
- `Live.reconnect(stream)` reconnects a `RemoteLiveStream`.
- Regular Effect `Stream` operators remain the primary composition model.

## Runtime model

The client adapter wraps SvelteKit's live query result in `RemoteLiveStream`.
That stream keeps the transport metadata needed by `Live.status` and
`Live.reconnect`, while `.pipe(...)` preserves the brand for normal
stream-to-stream pipelines.

The server path validates that live handlers return Effect streams. It converts
the stream through `Stream.toAsyncIterableEffect` and wraps stream failures in
the same serialized remote failure envelope used by other remote functions, both
before the first value and after streaming has started.

## Yield semantics

SER generated code now lowers `yield* value` through `ToEffect(value)`.

- `Effect` values are yielded as before.
- `Stream` values resolve to their first emitted value with `Stream.runHead`.
- Empty streams fail with `EmptyStreamYieldError`.

This applies across script effects, control-flow statements, markup
expressions, event-like attributes, and language-server source relocations.

## Language server and VSIX

The language-server build now embeds all root runtime declaration and runtime
assets, not only root JavaScript files. That keeps `Live`, `RemoteLiveStream`,
`Yieldable`, `YieldSuccess`, and `ToEffect` available to the VSIX embedded
runtime declarations.

The hover/diagnostic relocation logic maps original `yield*` operands to their
generated `ToEffect(...)` operands, so editor diagnostics stay on the user code
instead of the generated wrapper.

## Documentation

The docs now describe `Query.live` as stream-native:

- Server snippets return Effect streams.
- Client snippets treat live query calls as `RemoteLiveStream`.
- Status and reconnect are shown through `Live`.
- The migration note replaces `.current`, `.ready`, `.connected`, and
  `.reconnect()` resource usage with `yield* stream`, `Live.status(stream)`,
  and `Live.reconnect(stream)`.

The README hero avoids implying that `yield*` subscribes forever by using a
non-live price example there.

## Review findings handled

- Generic script statements with `yield*` now use `ToEffect`.
- Markup relocation no longer maps an original operand to the whole generated
  wrapper.
- Duplicate generated call relocations now target the matching yielded operand.
- Live stream failures after iteration starts are serialized as remote failures.
- Failed live status wins over closed status when both are present.
- Input-bearing live query overloads require a function.
- `Live.status` and `Live.reconnect` only accept `RemoteLiveStream`.
- Embedded VSIX runtime declarations include the new root `.d.ts` files.

## Verification

- `vp test run`
- `vp check --no-lint @files`
- `corepack pnpm --dir modules/svelte-effect-runtime run check`
- `corepack pnpm --dir modules/svelte-effect-runtime-language-server run build`
- `vp test run .tests/svelte-effect-runtime-language-server/runtime/language-server.test.ts`
