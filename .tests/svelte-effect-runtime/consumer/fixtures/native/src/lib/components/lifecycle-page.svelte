<script lang="ts">
	import { GetLifecycle } from "$lib/conformance.remote";

	const lifecycle = GetLifecycle();
</script>

<p data-testid="lifecycle">{await lifecycle}</p>
