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

Write effectful code without any hassle. Seriously!

```svelte
<script lang="ts" effect>
  import { Effect } from "effect";
  import { GetPosts, UpvotePost } from "./posts.remote";
</script>

<ul>
  {#each yield* GetPosts() as { title, link }}
    <li>
      <a href={link}>{title}</a>
      <button onclick={yield* UpvotePost()}>Upvote</button>
    </li>
  {/each}
</ul>
```

## Packages

| Package | Description |
|---------|-------------|
| [`svelte-effect-runtime`](./modules/svelte-effect-runtime) | Core module that houses the Vite plugin to enable effectful execution. |
| [`svelte-effect-runtime-language-server`](./modules/svelte-effect-runtime-language-server) | The lower level standalone server that houses the LSP contract. |
| [`svelte-effect-runtime-vsix`](./modules/svelte-effect-runtime-vsix) | Higher level VSIX extension that has the LSP bundled.  |
| [`svelte-effect-runtime-zed`](./modules/svelte-effect-runtime-zed) | Higher level Zed extension that has the LSP bundled.  |

Visit the **[docs](https://ser.barekey.dev)** for guides and API reference.
