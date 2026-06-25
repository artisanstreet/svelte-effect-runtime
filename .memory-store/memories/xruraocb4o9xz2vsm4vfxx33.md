+++
schema = "memorystore.note/v1"
key = "xruraocb4o9xz2vsm4vfxx33"
tags = [
    "local-setup",
    "language-server",
    "vscode",
    "zed",
    "cursor",
]
created_at = "2026-06-25T13:23:42.9432495Z"
updated_at = "2026-06-25T13:28:10.5582516Z"
+++
On 2026-06-25, after fixing the LSP transform-error crash, local editor installs were refreshed from the repo build: VS Code installed `barekey.svelte-effect-runtime-vscode@3.1.0`; VS Code, Cursor, and Zed language-server caches point to/install `svelte-effect-runtime-language-server@3.1.0` from the local package path; Code and Cursor user settings set `svelte-effect-runtime.languageServer.path` to the repo `.dist/server.cjs`; Cursor's legacy `svelte.language-server.ls-path` was also updated to that server. A follow-up check found the installed Zed `extension.wasm` was still the old `3.0.2` artifact containing the obsolete `runtime/transform.js` check; it was replaced with the repo `wasm32-wasip2` release artifact, and installed Zed metadata was set to `3.1.0`. Zed must be fully restarted to unload the old wasm. Zed's `typescript-svelte-plugin@0.3.52` cache was restored. All three cache server scripts bootstrapped successfully and contained the transform-error fallback marker.