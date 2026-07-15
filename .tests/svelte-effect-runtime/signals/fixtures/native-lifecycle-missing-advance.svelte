<script lang="ts">
	let { record_event }: { record_event: (event: string) => void } = $props();

	$effect(() => {
		record_event("start:1");

		return () => record_event("finalize:1");
	});
</script>

<p data-testid="generation">1</p>
