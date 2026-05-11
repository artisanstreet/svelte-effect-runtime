<script lang="ts" effect>
	import { increment } from "$lib/commands.remote";
</script>

<h1>Command — pending state</h1>
<p>
	The wrapped command exposes a non-enumerable <code>.pending</code> property
	that aggregates SvelteKit's native pending count plus any in-flight Effect
	calls. Spam the button to watch it climb.
</p>

<button
	onclick={() => {
		yield* increment(1);
	}}
>
	Increment
</button>

<p>
	pending: <strong>{increment.pending}</strong>
</p>

<small>
	(Click rapidly — each click queues another request; the counter ticks down
	as they settle.)
</small>

<style>
	small {
		color: #666;
	}
</style>
