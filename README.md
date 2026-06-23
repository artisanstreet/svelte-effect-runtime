<p align="center">
  <img src="./.assets/banner.png" alt="Svelte Effect Runtime">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/svelte-effect-runtime">npm</a>
  •
  <a href="https://jsr.io/@barekey/svelte-effect-runtime">JSR</a>
  •
  <a href="https://open-vsx.org/extension/barekey/svelte-effect-runtime-vscode">OpenVSX</a>
  •
  <a href="https://marketplace.visualstudio.com/items?itemName=Barekey.svelte-effect-runtime-vscode">VS Code Marketplace</a>
</p>

---

Write effectful code without any hassle. Seriously!

```svelte
<script lang="ts" effect>
  import * as StockCard from "./ticker-card.ts";
  import { GetAllStocks, GetLivePrice } from "./tickers.remote.ts";
  import { GetUser } from "user.ts";
</script>

<ScrollArea>
  {const currency = $derived(yield* GetUser().preferredCurrency}
  
  {#each yield* GetAllStocks as stock}
    {const liveQuery = yield* GetLivePrice(stock.ticker);
    {const price = liveQuery.current ?? stock.initialPrice}

    <StockCard.Root>
      <StockCard.Header>{stock.name}</StockCard.Header>
      <StockCard.Price>{price} {currency.displayName}</StockCard.Price>
    </StockCard.Root>
  {/each}
</ScrollArea>
```

## Packages

| Package                                                                                    | Description                                                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`svelte-effect-runtime`](./modules/svelte-effect-runtime)                                 | Core module that houses the Vite plugin to enable effectful execution. |
| [`svelte-effect-runtime-language-server`](./modules/svelte-effect-runtime-language-server) | The lower level standalone server that houses the LSP contract.        |
| [`svelte-effect-runtime-vsix`](./modules/svelte-effect-runtime-vsix)                       | Higher level VSIX extension that has the LSP bundled.                  |
| [`svelte-effect-runtime-zed`](./modules/svelte-effect-runtime-zed)                         | Higher level Zed extension that has the LSP bundled.                   |

Visit the **[docs](https://ser.barekey.dev)** for guides and API reference.
