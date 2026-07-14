<script lang="ts" effect>
	import { Effect } from "effect";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let generation = $state(1);

	const ObserveGeneration = (observed_generation: number) =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* Effect.acquireRelease(
					Effect.sync(() => record_event(`start:${observed_generation}`)),
					() => Effect.sync(() => record_event(`finalize:${observed_generation}`)),
				);

				return yield* Effect.never;
			}),
		);

	const AdvanceGeneration = Effect.gen(function* () {
		generation = yield* Effect.succeed(generation + 1);
	});

	yield* ObserveGeneration(generation);
</script>

<button data-testid="advance" onclick={yield* AdvanceGeneration}>Advance</button>
<output data-testid="generation">{generation}</output>
