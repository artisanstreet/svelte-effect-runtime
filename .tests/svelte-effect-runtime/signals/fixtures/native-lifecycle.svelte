<script lang="ts">
	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let generation = $state(1);

	$effect(() => {
		const observed_generation = generation;

		record_event(`start:${observed_generation}`);

		return () => record_event(`finalize:${observed_generation}`);
	});
</script>

<button data-testid="advance" onclick={() => (generation += 1)}>Advance</button>
<output data-testid="generation">{generation}</output>
