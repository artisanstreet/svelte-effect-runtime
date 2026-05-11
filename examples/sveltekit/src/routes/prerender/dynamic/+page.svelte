<script lang="ts" effect>
	import { get_topic_dynamic } from "$lib/prerender.remote";

	const intro = yield* get_topic_dynamic("intro");
</script>

<h1>Prerender — dynamic</h1>
<p>
	<code>{`{ dynamic: true }`}</code> tells SvelteKit to refresh the prerendered
	value at runtime instead of locking the build-time snapshot in place.
	Reload the page to see <code>snapshot_at</code> change.
</p>

<pre>{JSON.stringify(intro, null, 2)}</pre>

<style>
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
