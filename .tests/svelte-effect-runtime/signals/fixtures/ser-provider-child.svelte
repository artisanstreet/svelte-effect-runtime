<script lang="ts" effect>
	import { ProvideLayer } from "svelte-effect-runtime/provide-layer.ts";
	import SerProviderLeaf from "./ser-provider-leaf.svelte";
	import { Greeting, Punctuated } from "./services.ts";

	ProvideLayer(Punctuated.layer);
</script>

<output data-testid="greeting">{(yield* Greeting).text}</output>
<SerProviderLeaf />
