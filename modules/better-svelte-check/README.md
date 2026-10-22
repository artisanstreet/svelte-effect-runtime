# better-svelte-check MVP

One-shot Svelte checking through the consuming project's Vite source transforms.
SER source stays on disk unchanged. The checker captures lowered components before
Svelte compilation, checks them with the pinned upstream language-tools engine,
and maps diagnostics back to authored components.

From this repository:

```sh
corepack pnpm run check:vite --workspace /absolute/path/to/app
corepack pnpm run check:vite --workspace /absolute/path/to/app --output json
```

Supported options are `--workspace`, `--tsconfig`, `--mode`, and `--output human|json`.
The defaults are the current directory, `tsconfig.json`, `development`, and `human`.
Errors produce exit code 1; warnings alone produce exit code 0.

`corepack pnpm run build:checker` produces `.dist/better-svelte-check/cli.js`.
That development artifact links to this workspace's checker dependencies. This
package is private and is not part of the publication pipeline.

## Implementation boundaries

- Uses the project's Vite 8 installation and vite-plugin-svelte 7 compilation hook.
- Runs the client development pipeline. `--mode` selects Vite's configuration mode;
  it does not run build-only or SSR transforms.
- Disables the script part of `vitePreprocess` to preserve TypeScript annotations.
  Markup and style preprocessing still run. Other script preprocessors are rejected.
- Prepares components selected by `tsconfig`, then prepares imported components discovered by
  TypeScript outside the initial crawl before accepting diagnostics.
- Uses svelte-language-server 0.18.4 and its synchronous snapshot engine. Its
  process-wide configuration and snapshot adapters are restored when checking ends.
  Run each project in a separate process.
- Source-transform plugins must supply accurate maps for accurate diagnostic
  positions. SER's whole-component transform now supplies a composed map, including
  relocated yield operands. Unmapped generated errors remain visible.
- The MVP supports `.svelte` components. Watch mode, upstream CLI parity, tsgo,
  Vite virtual-module type declarations, and source-writing CLI tools are out of scope.

The MVP reuses upstream's checking engine through a small adapter. It does not
vendor the language-tools repository. A maintained upstream fork can replace those
adapters with explicit prepared-source hooks after this approach is validated.
