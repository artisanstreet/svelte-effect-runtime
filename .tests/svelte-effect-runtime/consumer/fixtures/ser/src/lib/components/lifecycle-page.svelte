<script lang="ts" effect>
	import { GetLifecycle } from "$lib/conformance.remote";

	const Lifecycle = GetLifecycle();
	const lifecycle = yield* Lifecycle;
</script>

<p data-testid="lifecycle">{lifecycle}</p>
