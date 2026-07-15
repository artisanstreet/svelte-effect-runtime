<script lang="ts" effect>
	import { GetSnapshot } from "$lib/prerender.remote";

	const Snapshot = GetSnapshot();
	const snapshot = yield* Snapshot;
</script>

<p data-testid="ser-prerender">{snapshot}</p>
