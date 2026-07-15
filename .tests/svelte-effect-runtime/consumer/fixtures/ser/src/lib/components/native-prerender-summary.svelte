<script lang="ts" effect>
	import { GetSnapshot } from "$lib/native-prerender.remote";
	import { Effect } from "effect";

	const Snapshot = GetSnapshot();
	const SnapshotEffect = Effect.isEffect(Snapshot)
		? Snapshot
		: Effect.promise(() => Promise.resolve(Snapshot));
	const snapshot = yield* SnapshotEffect;
</script>

<p data-testid="snapshot">{snapshot}</p>
