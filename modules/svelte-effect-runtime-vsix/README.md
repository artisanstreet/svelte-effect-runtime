# Svelte Effect Runtime

VS Code extension for Svelte Effect Runtime.

The extension installs `svelte-effect-runtime-language-server` from npm and
launches it for `.svelte` files. In auto mode, it points the official Svelte
extension at the installed server when that extension is installed, avoiding
duplicate Svelte language servers. Without the official Svelte extension, it
starts its own VS Code language client directly.

Visit the [docs](https://ser.barekey.dev) for more information.
