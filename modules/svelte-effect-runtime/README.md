# svelte-effect-runtime

Runtime, Svelte preprocessor, and Vite plugin for writing Effect-TS programs inside Svelte 5 `<script effect>` blocks and SvelteKit `*.remote.ts` files. Uses `yield*` syntax that gets lowered into `Effect.gen` programs managed by a fiber-based dispatcher.

Visit the [docs](https://ser.barekey.dev) for more information.
