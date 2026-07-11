# SER Component Syntax

SER lets Svelte components use Effect programs directly. Keep the source close
to the user intent and let the Vite plugin lower it.

## Script Effect

Use `<script effect>` for component-local effectful execution:

```svelte
<script lang="ts" effect>
  import { get_user } from "./user.remote";

  let id = $state("ada");
  const user = yield* get_user({ id });
</script>
```

Top-level executable script work is lowered into SER runtime helpers. Nested
functions and callbacks are still normal JavaScript/TypeScript unless they are
explicit generator-based Effect code. Do not wrap top-level SER source in
`onMount` or hand-written `Effect.gen` unless the surrounding code already needs
an explicit Effect value.

Useful source forms include:

```svelte
<script lang="ts" effect>
  const user = yield* get_user(id);
  const { title } = yield* get_post(id);
  let label = $derived((yield* format(user.name)).toUpperCase());
  let raw = $state.raw(yield* load_raw(id));

  count = yield* next_count();
</script>
```

Keep `yield*` out of synchronous-only rune callbacks and class fields:

```svelte
<script lang="ts" effect>
  /** Wrong: synchronous rune callback. */
  $effect(() => yield* save());

  /** Wrong: synchronous derived callback. */
  const value = $derived.by(() => yield* compute());
</script>
```

## Markup Yield

Supported markup source forms include interpolation, conditions, loops, await
blocks, key blocks, declaration tags, render tags, html tags, and direct
event-like attributes.

```svelte
<p>{yield* render_name(user_id)}</p>

{#if yield* has_access(user_id)}
  <Dashboard />
{/if}

{#each yield* list_projects() as project}
  <button onclick={yield* archive_project(project.id)}>
    {project.name}
  </button>
{/each}

{#await yield* load_report(id)}
  <p>Loading</p>
{:then report}
  <Report {report} />
{/await}

{const price = yield* load_price(symbol)}
<Price value={price} />
```

## Event Attributes

Effectful event handlers must use deliberate yield-first syntax. SER generates
the event parameter for direct handlers.

```svelte
<button onclick={yield* save(id)}>Save</button>
<input oninput={yield* validate(event.currentTarget.value)} />
<button on:click={yield* save(id)}>Legacy directive form</button>
```

Do not place `yield*` inside event callbacks:

```svelte
<button onclick={() => yield* save(id)}>Wrong</button>
<input oninput={(event) => yield* validate(event)} />
```

Do not use ordinary prop attributes as hidden effect sites:

```svelte
<Widget value={yield* load_value()} />
```

Prefer a supported declaration first:

```svelte
{const value = yield* load_value()}
<Widget {value} />
```

## Effect.gen

Existing `Effect.gen(function* () { ... })` is still normal Effect code. Do not
delete it when it is intentionally building an Effect value. Also do not add it
only to appease plain Svelte tooling when direct SER `yield*` is valid.
