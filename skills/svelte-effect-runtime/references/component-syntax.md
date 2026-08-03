# SER Component Syntax

SER source is Svelte 5 plus a compile-time transform. Direct `yield*` in
components is the feature — never a syntax error to repair. The transform
replaces each supported `yield*` with a Dispatcher operation carrying its
source position and reactive inputs; the Dispatcher runs it as a managed
fiber and interrupts stale fibers when inputs change or the component is
destroyed.

## Opt in per component

```svelte
<script lang="ts" effect>
```

The `effect` attribute enables the transform for that component's script and
markup. Everything not using a supported `yield*` position remains ordinary
Svelte.

## Script positions

### ✅ Supported

Top-level declarations, assignments, destructuring, control flow, and the
async-expression-compatible runes: `$derived`, `$state`, `$state.raw`,
`$state.snapshot`, `$bindable`.

```svelte
<script lang="ts" effect>
	import { LoadProfile } from "./profile.remote";

	let user_id = $state("42");
	let profile = $state(yield* LoadProfile({ user_id }));
	const { name } = yield* LoadProfile({ user_id });
	let label = $derived((yield* Format(name)).toUpperCase());

	profile = yield* LoadProfile({ user_id });
</script>
```

`user_id` is a reactive input: when it changes, SER interrupts the previous
fiber before starting the next, so stale results never land.

### ❌ Unsupported

```svelte
<script lang="ts" effect>
	/** ❌ Sync rune callbacks — Svelte contract requires synchronous bodies. */
	$effect(() => yield* Save());
	const value = $derived.by(() => yield* Compute());

	/** ❌ Runes outside the compatible set. */
	let props = $props(yield* Load());
	$inspect(yield* Load());

	/** ❌ Class fields — object construction is not component work. */
	class Store {
		value = yield* LoadValue();
	}

	/** ❌ await and yield* in one statement (AwaitInEffectWorkError). */
	record(await transform(yield* Load()));

	/** ❌ Nested plain functions are ordinary JavaScript — no direct yield*. */
	const helper = () => yield* Load();
</script>
```

For nested logic, write an Effect-returning helper and yield it at a
supported position:

```svelte
<script lang="ts" effect>
	const save_theme = (next: string) => storage.set("theme", next);
</script>

<button onclick={yield* save_theme("dark")}>Use dark theme</button>
```

Ordinary top-level `await` in a statement with no `yield*` is untouched by
SER and follows Svelte's own async rules.

## Markup positions

### ✅ Supported

```svelte
<p>{yield* LoadStatus()}</p>

{#if yield* HasAccess(user_id)}
	<Dashboard />
{/if}

{#each yield* ListProjects() as project}
	<ProjectCard {project} />
{/each}

{#await yield* LoadReport(report_id)}
	<p>Loading report...</p>
{:then report}
	<Report {report} />
{/await}

{#key yield* ActiveWorkspace()}
	<Workspace />
{/key}

{const price = yield* LoadPrice(symbol)}
<Price value={price} />

{@render yield* LoadSnippet()}
{@html yield* RenderMarkup()}
```

Declaration tags (`{const ...}`) are the way to feed effectful values into
ordinary props. Legacy `{@const ...}` still works; prefer `{const ...}` in
new code.

### ❌ Unsupported

```svelte
<!-- ❌ Ordinary props are not effect sites (UnsupportedMarkupEffectPositionError). -->
<Widget value={yield* LoadValue()} />

<!-- ❌ Debug tags are left untouched by SER. -->
{@debug yield* InspectState()}
```

Resolve first, then pass:

```svelte
{const value = yield* LoadValue()}
<Widget {value} />

{const debug_state = yield* InspectState()}
{@debug debug_state}
```

## Event attributes

A direct `yield*` in an event attribute tells SER to run the effect when the
event fires. SER generates the handler and provides the DOM `event`
identifier. Each firing starts a fresh fiber, bound to the component scope.

### ✅ Supported

```svelte
<button onclick={yield* Save(project_id)}>Save</button>

<input oninput={yield* Validate(event.currentTarget.value)} />

<!-- Legacy directive form also works; prefer event attributes in new code. -->
<button on:click={yield* Save(project_id)}>Save</button>
```

### ❌ Rejected or silently broken

```svelte
<!-- ❌ YieldStarInEventCallbackError: the callback boundary is JavaScript's. -->
<button onclick={() => yield* Save(project_id)}>Save</button>
<button onclick={function (event) { yield* Validate(event); }}>Go</button>

<!-- ❌ AsyncEffectInEventCallbackError: yield* nested in an opaque callback
     inside an otherwise direct event expression. -->
<button onclick={yield* Effect.try(() => yield* Save())}>Save</button>

<!-- ❌ WORST: valid JavaScript that builds the Effect and discards it.
     No error, no execution, silent no-op. -->
<button onclick={() => Save(project_id)}>Save</button>
```

Without `yield*`, an event attribute is an ordinary Svelte handler — fine for
pure UI state, wrong for anything effectful.

## Rendering semantics worth knowing

- Reactive markup gets a fallback on the first render pass; when the fiber
  succeeds the Dispatcher caches the value per source position + inputs and
  notifies Svelte. Changed inputs produce a new cache key and interrupt the
  pending fiber for the old one.
- `{#await yield* ...}` receives a promise the Dispatcher creates and reuses
  while position + inputs are stable.
- During SSR the server Dispatcher is used; after hydration client sites use
  the client Dispatcher.
- Component destruction and HMR interrupt in-flight fibers, run finalizers,
  and clear component-local caches — including effects started by event
  handlers.
- `yield*` on a `Query.live` stream reads only the first element (and fails
  with `EmptyStreamYieldError` if the stream completes without emitting).
  For continuous consumption use
  `yield* stream.pipe(Stream.runForEach(...))` — see remote-functions.md.
