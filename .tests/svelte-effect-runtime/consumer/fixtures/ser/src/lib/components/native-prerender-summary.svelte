<script lang="ts" effect>
	import { GetSnapshot } from "$lib/native-prerender.remote";
	import { ToRemoteEffect } from "$lib/remote-compat";

	const snapshot = yield* ToRemoteEffect(GetSnapshot());
</script>

<p data-testid="snapshot">{snapshot}</p>
