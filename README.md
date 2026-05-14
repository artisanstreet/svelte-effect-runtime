<p align="center">
  <img src="./.assets/banner.png" alt="Svelte Effect Runtime">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/svelte-effect-runtime">npm</a>
  •
  <a href="https://jsr.io/@barekey/svelte-effect-runtime">JSR</a>
  •
  <a href="https://open-vsx.org/extension/barekey/svelte-effect-runtime-vscode">OpenVSX</a>
  •
  <a href="https://marketplace.visualstudio.com/items?itemName=Barekey.svelte-effect-runtime-vscode">VS Code Marketplace</a>
</p>

---

Write **Svelte 5** components and **SvelteKit** remote functions using [Effect-TS](https://effect.website). Use `yield*` inside `<script effect>` blocks — the preprocessor lowers them into `Effect.gen` programs that fork on mount, wire into `$state`, and cancel on unmount.

```svelte
<script lang="ts" effect>
  import { getUser } from "$lib/api.js";
  let user = $state(yield* getUser(id));
</script>

<h1>{user.name}</h1>
```

## Packages

| Package | Description |
|---------|-------------|
| [`svelte-effect-runtime`](./modules/svelte-effect-runtime) | Runtime + preprocessor + Vite plugin. Installed in your SvelteKit project. |
| [`svelte-effect-runtime-language-server`](./modules/svelte-effect-runtime-language-server) | LSP binary that teaches the Svelte language server about `yield*` syntax. |
| [`svelte-effect-runtime-vsix`](./modules/svelte-effect-runtime-vsix) | VS Code / Cursor extension. Installs the language server and configures the editor. |

Visit the **[docs](https://ser.barekey.dev)** for guides and API reference.
