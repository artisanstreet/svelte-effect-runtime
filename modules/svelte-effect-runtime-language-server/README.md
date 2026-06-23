# Svelte Effect Runtime Language Server

Language server for Svelte Effect Runtime syntax in Svelte files.

This package ships the compiled Node language server used by the VS Code and Zed
extensions. It includes the bundled server entrypoint, SER runtime assets, and
the Node dependencies the editor integrations need at runtime.

Zed installs this package from npm and starts the compiled server directly:

```sh
node ./node_modules/svelte-effect-runtime-language-server/.dist/server.cjs --stdio
```

The package is primarily an editor-integration dependency. Application projects
should install `svelte-effect-runtime` instead.

Visit the [docs](https://ser.barekey.dev) for more information.
