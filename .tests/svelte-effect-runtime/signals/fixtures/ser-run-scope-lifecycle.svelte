<script lang="ts" effect>
	import { Effect, PubSub, Stream } from "effect";

	interface Props {
		record_event: (event: string) => void;
	}

	let { record_event }: Props = $props();

	let generation = $state(1);

	const events = yield* PubSub.unbounded<number>();
	const Observe = (observed_generation: number) =>
		Effect.gen(function* () {
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => record_event(`finalize:${observed_generation}`)),
			);
			yield* Effect.sync(() => record_event(`start:${observed_generation}`));
			yield* Stream.fromPubSub(events).pipe(
				Stream.runForEach((value) =>
					Effect.sync(() => record_event(`value:${observed_generation}:${value}`)),
				),
			);
		});
	const AdvanceGeneration = Effect.gen(function* () {
		generation = yield* Effect.succeed(generation + 1);
	});
	const PublishGeneration = Effect.gen(function* () {
		yield* PubSub.publish(events, generation);
	});

	yield* Observe(generation).pipe(Effect.forkScoped);
</script>

<button data-testid="advance-run-scope" onclick={yield* AdvanceGeneration}>Advance</button>
<button data-testid="publish-run-scope" onclick={yield* PublishGeneration}>Publish</button>
<output data-testid="run-scope-generation">{generation}</output>
