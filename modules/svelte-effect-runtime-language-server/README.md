# Svelte Effect Runtime Language Server

Language server for Svelte Effect Runtime syntax in Svelte files.

This package ships the compiled Node language server used by editor
integrations. It includes the bundled server entrypoint, SER runtime assets, and
the Node dependencies those integrations need at runtime.

Editor integrations can start the compiled server directly:

```sh
node ./node_modules/svelte-effect-runtime-language-server/.dist/server.cjs --stdio
```

The package is primarily an editor-integration dependency. Application projects
should install `svelte-effect-runtime` instead.

Visit the [docs](https://docs.barekey.dev/ser/tooling) for more information.
