<script lang="ts" effect>
	import { GetSharedLive } from "$lib/conformance.remote";
	import { Live } from "svelte-effect-runtime";
	import { Effect, Stream } from "effect";

	const LeftStream = GetSharedLive("shared");
	const RightStream = GetSharedLive("shared");

	let left_value = $state(yield* LeftStream);
	let right_value = $state(yield* RightStream);
	let left_status = $state("Connecting");
	let right_status = $state("Connecting");

	const ObserveLeft = Stream.runForEach(LeftStream, (value) =>
		Effect.gen(function* () {
			left_value = value;
		}),
	);
	const ObserveRight = Stream.runForEach(RightStream, (value) =>
		Effect.gen(function* () {
			right_value = value;
		}),
	);
	const ObserveLeftStatus = Stream.runForEach(LeftStream.pipe(Live.status), (status) =>
		Effect.gen(function* () {
			left_status = status._tag;
		}),
	);
	const ObserveRightStatus = Stream.runForEach(RightStream.pipe(Live.status), (status) =>
		Effect.gen(function* () {
			right_status = status._tag;
		}),
	);

	yield* ObserveLeft;
	yield* ObserveRight;
	yield* ObserveLeftStatus;
	yield* ObserveRightStatus;

	const ReconnectLive = Effect.gen(function* () {
		yield* LeftStream.pipe(Live.reconnect);
	});
</script>

<p data-testid="live-left">{left_value}</p>
<p data-testid="live-right">{right_value}</p>
<p data-testid="live-left-status">{left_status}</p>
<p data-testid="live-right-status">{right_status}</p>
<p data-testid="live-left-done">{String(left_status === "Closed")}</p>
<p data-testid="live-right-done">{String(right_status === "Closed")}</p>
<button data-testid="live-reconnect" onclick={yield* ReconnectLive}>Reconnect live query</button>
