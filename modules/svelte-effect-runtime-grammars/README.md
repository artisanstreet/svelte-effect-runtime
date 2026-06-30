# svelte-effect-runtime-grammars

TextMate and tree-sitter grammar data for Svelte Effect Runtime tooling.

This package owns the source grammar assets used by SER-aware tooling.

The npm package also publishes raw grammar assets as package subpaths:

- `svelte-effect-runtime-grammars/textmate/svelte-effect-runtime.tmLanguage.json`
- `svelte-effect-runtime-grammars/tree-sitter/highlights.tsq`
- `svelte-effect-runtime-grammars/tree-sitter/injections.tsq`

## Publishing to npm

From the repository root:

```sh
deno task publish:grammars:npm
```

For a publish rehearsal:

```sh
deno task publish:grammars:npm --dry-run
```

The command checks, builds, verifies the npm tarball contents, confirms the
version is not already published, and then runs `npm publish --access public`.
Run `npm login` first, or set `NPM_TOKEN` for the command.
