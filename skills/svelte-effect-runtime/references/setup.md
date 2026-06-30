# SER Setup

SER component syntax only works when the Svelte source flows through the SER
Vite plugin before Svelte parses it.

## Required Packages

Install both `svelte-effect-runtime` and `effect`. Follow the repository's
package manager. In this workspace, prefer Deno unless a lockfile says
otherwise; do not use npm for Bun or Deno projects.

## Svelte Config

Enable async rendering for component `yield*`:

```js
const config = {
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
};

export default config;
```

Enable remote functions when using `Query`, `Command`, `Form`, or `Prerender`:

```js
const config = {
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
  kit: {
    experimental: {
      remoteFunctions: true,
    },
  },
};

export default config;
```

## Vite Config

Put `effect()` before `sveltekit()`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { effect } from "svelte-effect-runtime";

export default defineConfig({
  plugins: [effect(), sveltekit()],
});
```

Parser-style Vite plugins that parse `.svelte` before SER runs can reject valid
SER source. If another plugin parses Svelte, keep `effect()` first.
