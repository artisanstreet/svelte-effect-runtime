<script lang="ts" effect>
	import {
		GetBuildSnapshot,
		GetDynamicSnapshot,
	} from "$lib/native-prerender.remote";
	import { Effect } from "effect";

	const BuildSnapshot = GetBuildSnapshot();
	const DynamicSnapshot = GetDynamicSnapshot("runtime");
	const BuildSnapshotEffect = Effect.isEffect(BuildSnapshot)
		? BuildSnapshot
		: Effect.promise(() => Promise.resolve(BuildSnapshot));
	const DynamicSnapshotEffect = Effect.isEffect(DynamicSnapshot)
		? DynamicSnapshot
		: Effect.promise(() => Promise.resolve(DynamicSnapshot));
	const build_snapshot = yield* BuildSnapshotEffect;
	const dynamic_snapshot = yield* DynamicSnapshotEffect;
</script>

<p data-testid="prerender-build">{build_snapshot}</p>
<p data-testid="prerender-runtime">{dynamic_snapshot}</p>
