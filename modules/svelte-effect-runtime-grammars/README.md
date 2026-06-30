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
cd modules/svelte-effect-runtime-grammars
deno task build
npm publish --access public
```

For a publish rehearsal:

```sh
cd modules/svelte-effect-runtime-grammars
deno task build
npm publish --access public --dry-run
```

Run `npm login` first. If npm asks for an OTP, pass it with
`npm publish --access public --otp 123456`.
