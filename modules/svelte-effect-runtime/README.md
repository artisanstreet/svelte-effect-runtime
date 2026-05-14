# svelte-effect-runtime

Write Svelte 5 components and SvelteKit remote functions using Effect-TS. Use `yield*` inside `<script effect>` blocks and `*.remote.ts` files — the preprocessor lowers them into `Effect.gen` programs that run on mount and cancel on unmount.

```svelte
<script lang="ts" effect>
  import { getUser } from "$lib/api.js";

  let user = $state(yield* getUser(id));
</script>

<h1>{user.name}</h1>
```

- Uses `yield*` for async Effect operations directly in your Svelte markup and script
- Built for Effect v4 with a clean dispatcher-based fiber lifecycle
- Ships a Svelte preprocessor for `.svelte` files and a Vite plugin for SvelteKit remote functions
- Zero-config default runtime — `ClientRuntime.make()` is optional

Visit the [docs](https://ser.barekey.dev) for guides, reference, and runnable examples.
