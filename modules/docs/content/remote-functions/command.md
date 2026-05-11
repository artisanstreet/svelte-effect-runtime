# Command

```ts
import { Command } from "svelte-effect-runtime";
```

`Command(...)` wraps SvelteKit's native `command()`. Like `Form`,
commands write data to the server; unlike `Form`, they're not bound to
a `<form>` element and can be called from anywhere. The client-side
return value is `Effect<Output, RemoteFailure<Error>, never>`.

> Prefer [`Form`](./form) where possible — it gracefully degrades when
> JavaScript is disabled.

## Minimal example

::: code-group

```ts [src/lib/counter.remote.ts]
import { Data, Effect, Schema } from "effect";
import { Command } from "svelte-effect-runtime";

class CounterOverflow extends Data.TaggedError("CounterOverflow")<{
  readonly attempted: number;
}> {}

let counter = 0;

export const increment = Command(Schema.Number, (by) =>
  Effect.gen(function* () {
    if (by > 1_000_000) {
      return yield* new CounterOverflow({ attempted: by });
    }
    counter += by;
    return counter;
  })
);

export const reset = Command(() =>
  Effect.sync(() => {
    counter = 0;
    return counter;
  })
);
```

```svelte [src/routes/+page.svelte]
<script lang="ts" effect>
  import { increment, reset } from "$lib/counter.remote";

  let value = $state<number | null>(null);
</script>

<button
  onclick={() => {
    value = yield* increment(1);
  }}
>
  +1
</button>

<button
  onclick={() => {
    value = yield* reset();
  }}
>
  Reset
</button>

{#if value !== null}
  <p>counter: {value}</p>
{/if}
```

:::

`yield*` works inside the **inline arrow** passed to `onclick` because
the preprocessor rewrites it. It does **not** work inside a separately
declared `function` — call the Effect directly in the arrow handler.

## Pending state

The wrapped command exposes a non-enumerable `pending` getter that
aggregates SvelteKit's native pending count plus any in-flight Effect
calls:

```svelte
<button disabled={increment.pending > 0} onclick={() => yield* increment(1)}>
  {increment.pending > 0 ? "saving…" : "+1"}
</button>
```

## Recovering from tagged failures

```svelte
<script lang="ts" effect>
  import { Effect } from "effect";
  import { increment } from "$lib/counter.remote";

  const value = yield* increment(2_000_000).pipe(
    Effect.catchTag("CounterOverflow", (err) =>
      Effect.succeed(`refusing to add ${err.attempted}`)
    )
  );
</script>
```

## Validation variants

```ts
// Schema-validated (recommended).
Command(Schema.Number, (by) => ...);

// Unchecked — input type is whatever you pass at the call site.
Command("unchecked", (payload: unknown) => ...);

// No-arg.
Command(() => ...);
```

## See also

- [Command examples in the gallery](https://github.com/usebarekey/svelte-effect-runtime/tree/master/examples/sveltekit/src/routes/command)
  — schema-validated, void, pending, tagged-error recovery.
