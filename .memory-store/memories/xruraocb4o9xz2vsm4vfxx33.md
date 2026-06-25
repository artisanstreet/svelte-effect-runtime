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
updated_at = "2026-06-25T13:23:42.9432495Z"
+++
On 2026-06-25, after fixing the LSP transform-error crash, local editor installs were refreshed from the repo build: VS Code installed `barekey.svelte-effect-runtime-vscode@3.1.0`; VS Code, Cursor, and Zed language-server caches point to/install `svelte-effect-runtime-language-server@3.1.0` from the local package path; Code and Cursor user settings set `svelte-effect-runtime.languageServer.path` to the repo `.dist/server.cjs`; Cursor's legacy `svelte.language-server.ls-path` was also updated to that server; Zed's installed `extension.wasm`/`extension.toml` and `typescript-svelte-plugin@0.3.52` cache were refreshed. All three cache server scripts bootstrapped successfully and contained the transform-error fallback marker.