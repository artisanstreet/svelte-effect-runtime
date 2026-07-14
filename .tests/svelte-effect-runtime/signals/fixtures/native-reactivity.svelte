<script lang="ts">
	interface Props {
		resolve_value: (primary: number, secondary: number) => Promise<string>;
	}

	let { resolve_value }: Props = $props();

	let primary = $state(1);
	let secondary = $state(10);

	const resolved_value = $derived(await resolve_value(primary, secondary));
</script>

<button data-testid="primary" onclick={() => (primary += 1)}>Primary</button>
<button data-testid="secondary" onclick={() => (secondary += 1)}>Secondary</button>
<output data-testid="value">{resolved_value}</output>
