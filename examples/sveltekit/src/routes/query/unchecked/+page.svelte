<script lang="ts" effect>
	import { get_count } from "$lib/queries.remote";

	const count_info = yield* get_count();
</script>

<h1>Query — <code>"unchecked"</code></h1>
<p>
	When the validation slot is the literal <code>"unchecked"</code>, the query
	accepts whatever input you pass without schema parsing. Useful for trivial
	internal calls.
</p>

<pre>{JSON.stringify(count_info, null, 2)}</pre>

<style>
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
