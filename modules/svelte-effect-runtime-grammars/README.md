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
corepack pnpm run build:grammars
vp node build/pack.ts svelte-effect-runtime-grammars
corepack pnpm publish .dist/svelte-effect-runtime-grammars/*.tgz --access public --provenance --no-git-checks
```

For a publish rehearsal:

```sh
corepack pnpm run build:grammars
vp node build/pack.ts svelte-effect-runtime-grammars
corepack pnpm publish .dist/svelte-effect-runtime-grammars/*.tgz --access public --dry-run --no-git-checks
```

Run `corepack pnpm login` first. If npm asks for an OTP, pass it with
`--otp 123456`.
