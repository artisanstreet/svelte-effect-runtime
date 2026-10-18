<script lang="ts" effect>
	import { Effect } from "effect";
	import { fork } from "svelte";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let key = $state(1);

	const Load = (value: number) =>
		Effect.sync(() => {
			record_event(`load:${value}`);

			return `ready:${value}`;
		});

	export function speculate() {
		return fork(() => {
			key = 2;
		});
	}
</script>

<output data-testid="value">{yield* Load(key)}</output>
