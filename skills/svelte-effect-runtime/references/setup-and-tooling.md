# Setup, Tooling, and Validation

SER component syntax only exists after the SER Vite plugin transforms the
source. Setup mistakes and non-Vite tooling are the two root causes of
"SER syntax is invalid" false alarms.

## Packages

- `svelte-effect-runtime` — the plugin and runtime (peer: `effect`
  `^4.0.0-beta`, `svelte` 5, `@sveltejs/kit` `^2.69.0 || ^3.0.0-next`).
- `svelte-plugin-composer` (dev) — recommended; makes plugins run in the
  order you wrote them instead of letting `enforce: "pre"` plugins skip the
  queue.

Use the project's package manager as indicated by its lockfile.

## Vite config

`effect()` must run before anything that parses Svelte — it lowers extended
syntax other plugins would reject:

```ts
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { effect } from "svelte-effect-runtime";
import { compose } from "svelte-plugin-composer";

export default defineConfig({
	plugins: compose([
		effect(),
		sveltekit({
			compilerOptions: {
				experimental: {
					async: true,
				},
			},
			experimental: {
				remoteFunctions: true,
			},
		}),
	]),
});
```

- `experimental.async: true` (Svelte async rendering) is required for
  component `yield*`.
- `experimental.remoteFunctions: true` is required for `Query`, `Command`,
  `Form`, `Prerender`; omit only if remote functions are unused.
- Without composer, keep `effect()` first in a plain `plugins` array.
- Since 4.0.0 the compiler entrypoint is `svelte-effect-runtime/compiler`;
  the root `svelte-effect-runtime` export of `effect` also works.

## File naming is part of the contract

SER's server import rewrite recognizes `*.remote.ts`, `*.server.ts`, their
module-suffix variants, and `hooks.server.ts`. Server-only exports
(`Query`, `Command`, `Form`, `Prerender`, `Error`, `Redirect`,
`RequestEvent`, `ServerRuntime`, …) imported from the package root are
throwing placeholders everywhere else — invoking one from an unrecognized
file throws `ServerOnlyImportError`. Declare remote functions in
`*.remote.ts`, period.

## Validation: trust the transform, not the parser

Plain Svelte tooling does not run the SER transform. `svelte-check`, generic
Svelte parsers, formatters, and autofix tools will report false positives on:

- `<script effect>` / `<script lang="ts" effect>`
- direct `yield*` in markup, blocks, and declaration tags
- yield-first event attributes (`onclick={yield* Save(id)}`)

Never "fix" these reports by rewriting valid SER source. Treat such
diagnostics as non-authoritative unless they concern ordinary Svelte code
outside SER's source forms.

Validate through commands that run the Vite pipeline:

- the app's Vite build (`vite build` / the project's build script)
- the app's Vite-powered test command
- in the SER repository itself: the runtime conformance tests under
  `.tests/`

When a tool reports a syntax error on valid-looking SER source, check setup
before touching the source: is `effect()` present and first, is async
rendering on, is the remote-functions flag on, does the failing command
actually run through Vite?

`better-svelte-check` (loads the Vite config before running svelte-check so
the checker sees lowered source) is planned but not yet released — do not
add it as a dependency.

## IDE support

A VS Code extension (`Barekey.svelte-effect-runtime-vscode` on the Visual
Studio Marketplace, `barekey/svelte-effect-runtime-vscode` on OpenVSX) adds
IntelliSense for the extended grammar. Its absence in a contributor's editor
does not make the syntax wrong.
