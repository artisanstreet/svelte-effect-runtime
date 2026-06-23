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

For local development, install a fresh local copy with one command:

```sh
deno task install:zed-local
```

That builds the sibling language-server package, builds the Zed WASM extension,
copies both into Zed's local `installed/svelte-effect-runtime` directory, and
updates Zed's local extension index.

The extension resolves the server in this order:

1. `node_modules/svelte-effect-runtime-language-server/.dist/server.cjs` in the
   open worktree.
2. `../svelte-effect-runtime-language-server/.dist/server.cjs` for this repo.
3. `node_modules/svelte-effect-runtime-language-server/.dist/server.cjs` copied
   beside the locally installed extension.
4. `node_modules/svelte-effect-runtime-language-server/.dist/server.cjs`
   installed beside the extension by Zed.

Each path is only used when the package also contains its bundled
`runtime/package.json`. If no local development build is available, the
extension installs the standalone `svelte-effect-runtime-language-server`
package from npm and runs that copy.
