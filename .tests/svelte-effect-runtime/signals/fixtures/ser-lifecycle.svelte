<script lang="ts" effect>
	import { Effect } from "effect";

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

	const AdvanceGeneration = Effect.gen(function* () {
		generation = yield* Effect.succeed(generation + 1);
	});
</script>

<button data-testid="advance" onclick={yield* AdvanceGeneration}>Advance</button>
<output data-testid="generation">{generation}</output>
