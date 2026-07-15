<script lang="ts">
	import { GetSharedLive } from "$lib/conformance.remote";

	const left_resource = GetSharedLive("shared");
	const right_resource = GetSharedLive("shared");

	const left_initial = await left_resource;
	const right_initial = await right_resource;

	async function reconnect_live() {
		await left_resource.reconnect();
	}
</script>

<p data-testid="live-left">{left_resource.current ?? left_initial}</p>
<p data-testid="live-right">{right_resource.current ?? right_initial}</p>
<p data-testid="live-left-status">{left_resource.connected ? "Open" : "Connecting"}</p>
<p data-testid="live-right-status">{right_resource.connected ? "Open" : "Connecting"}</p>
<p data-testid="live-left-done">{String(left_resource.done)}</p>
<p data-testid="live-right-done">{String(right_resource.done)}</p>
<button data-testid="live-reconnect" onclick={reconnect_live}>Reconnect live query</button>
