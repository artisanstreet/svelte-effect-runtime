<script lang="ts" effect>
	import { increment } from "$lib/commands.remote";

	let last = $state<number | null>(null);
	let by = $state(1);
</script>

<h1>Command — Schema-validated</h1>
<p>
	<code>increment</code> takes a <code>Schema.Number</code> and mutates a
	server-scoped counter. Commands return an Effect just like queries; yield
	to run.
</p>

<label>
	Step
	<input type="number" bind:value={by} />
</label>
<button
	onclick={() => {
		last = yield* increment(by);
	}}
>
	Increment by {by}
</button>

{#if last !== null}
	<p>counter is now <strong>{last}</strong></p>
{/if}

<style>
	label {
		display: block;
		margin: 0.5rem 0;
	}
	input {
		padding: 0.4rem;
		width: 6rem;
	}
</style>
