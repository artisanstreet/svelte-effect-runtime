<script lang="ts" effect>
	import { reset_counter } from "$lib/commands.remote";

	let value = $state<number | null>(null);
</script>

<h1>Command — void input</h1>
<p>
	<code>Command(() =&gt; Effect.succeed(...))</code> defines a no-arg
	command. Call it with no arguments and yield the resulting Effect.
</p>

<button
	onclick={() => {
		value = yield* reset_counter();
	}}
>
	Reset counter
</button>

{#if value !== null}
	<p>counter is now <strong>{value}</strong></p>
{/if}
