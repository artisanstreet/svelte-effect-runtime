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

For local development, point Zed at your local language-server binary with
`lsp.svelte-effect-runtime-language-server.binary.path`:

```json
{
  "lsp": {
    "svelte-effect-runtime-language-server": {
      "binary": {
        "path": "/path/to/svelte-effect-runtime-language-server",
        "arguments": ["--stdio"]
      }
    }
  }
}
```

The extension resolves the server in this order:

1. `lsp.svelte-effect-runtime-language-server.binary.path` from Zed settings.
2. `svelte-effect-runtime-language-server` on the worktree `PATH`.
3. `node_modules/svelte-effect-runtime-language-server/.dist/server.cjs` beside
   the extension.
4. A GitHub release asset matching this extension's `extension.toml` version.

When the release asset path is used, the extension installs the public Node
dependencies that the bundled server needs beside the extension. The language
server package itself is private and is not resolved through npm. Local testing
should use the Zed settings override above.
