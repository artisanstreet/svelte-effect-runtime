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
2. `node_modules/svelte-effect-runtime-language-server/.dist/server.cjs` in the
   open worktree.
3. `../svelte-effect-runtime-language-server/.dist/server.cjs` for this repo.
4. A GitHub release asset matching this extension's `extension.toml` version.

When the release asset path is used, the extension installs the public Node
dependencies that the bundled server needs beside the extension. The language
server package itself is private and is not resolved through npm.
