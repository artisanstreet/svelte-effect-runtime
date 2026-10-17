<script lang="ts">
	import { fork } from "svelte";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let key = $state(1);

	async function load(value: number) {
		record_event(`load:${value}`);

		return `ready:${value}`;
	}

	export function speculate() {
		return fork(() => {
			key = 2;
		});
	}
</script>

<output data-testid="value">{await load(key)}</output>
