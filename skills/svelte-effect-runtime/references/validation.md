# SER Validation

Do not use plain Svelte syntax checks as the final authority for SER source.

## Preferred Checks

Prefer validation that runs through the SER Vite transform:

- the app's Vite build command
- the app's Vite-powered test command
- this repository's runtime tests

In the SER repository:

```sh
cd .tests/svelte-effect-runtime
deno test --no-check -A runtime/
```

## Tooling False Positives

Tools such as `svelte-check`, official plain-Svelte diagnostics, generic Svelte
AST parsers, and formatter/autofix tools may reject:

- `<script effect>`
- direct `yield*` in markup
- direct `yield*` in declaration tags
- yield-first event handlers like `onclick={yield* save(id)}`

Those diagnostics are useful only when they account for the SER transform or
when they concern ordinary Svelte code outside SER source forms.

When a tool reports a syntax error around valid-looking SER syntax, check setup
first: `effect()` order, async rendering, remote function flag, and whether the
command actually runs through Vite.
