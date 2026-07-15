<script lang="ts">
	import { type Snippet, onMount } from "svelte";

	let { children }: { children: Snippet } = $props();
	let hydrated = $state(false);

	onMount(() => {
		hydrated = true;
	});
</script>

<p data-testid="hydration-ready" hidden>{hydrated}</p>
{@render children()}
