<script lang="ts" effect>
	import { ProvideLayer } from "svelte-effect-runtime/provide-layer.ts";
	import SerProviderChild from "./ser-provider-child.svelte";
	import { MakeGreetingLayer } from "./services.ts";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	ProvideLayer(MakeGreetingLayer(record_event));
</script>

<SerProviderChild />
