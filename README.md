<p align="center">
  <img src="./.assets/banner.png" alt="Svelte Effect Runtime">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/svelte-effect-runtime">npm</a>
  •
  <a href="https://open-vsx.org/extension/barekey/svelte-effect-runtime-vscode">OpenVSX</a>
</p>

---

Write effectful code without any hassle. Seriously!

```svelte
<script lang="ts" effect>
  import * as StockCard from "./ticker-card.ts";
  import { GetAllStocks, GetPrice } from "./tickers.remote.ts";
  import { GetUser } from "user.ts";
</script>

<ScrollArea>
  {const currency = $derived((yield* GetUser()).preferredCurrency)}

  {#each yield* GetAllStocks() as stock}
    {const price = yield* GetPrice(stock.ticker)}

    <StockCard.Root>
      <StockCard.Header>{stock.name}</StockCard.Header>
      <StockCard.Price>{price} {currency.displayName}</StockCard.Price>
    </StockCard.Root>
  {/each}
</ScrollArea>
```

## Packages

| Package                                                                                    | Description                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`svelte-effect-runtime`](./modules/svelte-effect-runtime)                                 | Core module that houses the Vite plugin to enable effectful execution.    |
| [`svelte-effect-runtime-grammars`](./modules/svelte-effect-runtime-grammars)               | TextMate and tree-sitter grammar data used by SER-aware tooling.          |
| [`svelte-effect-runtime-language-server`](./modules/svelte-effect-runtime-language-server) | Standalone npm package for the SER language server used by editor tools.  |
| [`svelte-effect-runtime-vsix`](./modules/svelte-effect-runtime-vsix)                       | VS Code extension that launches the SER language server for Svelte files. |

Visit the **[docs](https://barekey.dev/docs/ser)** for guides and API reference.
