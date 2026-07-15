<script lang="ts" effect>
	import {
		GetDynamicSnapshot,
	} from "$lib/native-prerender.remote";
	import { ToRemoteEffect } from "$lib/remote-compat";

	const build_snapshot = yield* ToRemoteEffect(GetDynamicSnapshot("static"));
	const dynamic_snapshot = yield* ToRemoteEffect(GetDynamicSnapshot("runtime"));
</script>

<p data-testid="prerender-build">{build_snapshot}</p>
<p data-testid="prerender-runtime">{dynamic_snapshot}</p>
