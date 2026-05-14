# svelte-effect-runtime-language-server

Grammar-aware Svelte language server that understands `<script effect>` blocks and `yield*` syntax. Patches into the stock Svelte LSP to provide correct TypeScript diagnostics, hover info, and go-to-definition for Effect code inside Svelte components.

- Maps source positions between original `<script effect>` syntax and generated JavaScript so the Svelte LSP sees valid TypeScript
- Preserves type information through the yield* lowering pass
- Ships as a standalone binary (`svelte-effect-runtime-language-server`) for use with any editor that speaks LSP
- Auto-configured by the VS Code extension — no manual setup needed

Visit the [docs](https://ser.barekey.dev) for more information.
