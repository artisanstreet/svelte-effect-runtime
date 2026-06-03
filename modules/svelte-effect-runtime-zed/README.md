# Svelte Effect Runtime for Zed

This extension registers the SER language server for Zed's existing `Svelte`
language support. For now, keep the stock Zed Svelte extension installed for
grammar/highlighting.

The important bit is that SER should be the only Svelte language server running.
If the stock Zed Svelte extension is installed, keep it for grammar/highlighting
but disable its language server:

```json
{
  "languages": {
    "Svelte": {
      "language_servers": [
        "svelte-effect-runtime-language-server",
        "!svelte-language-server",
        "..."
      ]
    }
  }
}
```

For local development, build the sibling language-server package first:

```sh
cd modules/svelte-effect-runtime-language-server
deno task build
```

The extension resolves the server in this order:

1. `svelte-effect-runtime-language-server` on the worktree `PATH`.
2. `../svelte-effect-runtime-language-server/.dist/server.cjs` for this repo.
3. An extension-managed npm install of `svelte-effect-runtime-language-server`.

The npm fallback is for the published package path; local testing should use the
sibling `.dist/server.cjs` path above.
