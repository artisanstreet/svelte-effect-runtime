<script lang="ts">
	import { GetSnapshot } from "$lib/prerender.remote";

	const snapshot = GetSnapshot();
</script>

<p data-testid="ser-prerender">{await snapshot}</p>
