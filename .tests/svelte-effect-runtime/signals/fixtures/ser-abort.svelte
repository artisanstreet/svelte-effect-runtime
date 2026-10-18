<script lang="ts" effect>
	import { Effect } from "effect";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let shown = $state(true);

	const Pending = Effect.never.pipe(
		Effect.onInterrupt(() => Effect.sync(() => record_event("interrupted"))),
	);

	const Hide = Effect.sync(() => {
		shown = false;
	});
</script>

<button data-testid="hide" onclick={yield* Hide}>Hide</button>
<svelte:boundary>
	{#if shown}
		<output data-testid="pending">{yield* Pending}</output>
	{/if}

	{#snippet pending()}
		<output data-testid="loading">loading</output>
	{/snippet}
</svelte:boundary>
<output data-testid="mounted">mounted</output>
