<script lang="ts" effect>
	import { Effect } from "effect";
	import { explode } from "$lib/commands.remote";

	let outcome = $state<string>("");
</script>

<h1>Command — error handling</h1>
<p>
	<code>explode</code> fails with
	<code>Data.TaggedError("Boom")</code>. <code>Effect.catchTag</code>
	dispatches on the tag and gives you a typed handler with the original
	payload fields (<code>err.message</code>) intact.
</p>

<button
	onclick={() => {
		outcome = yield* explode("user-triggered").pipe(
			Effect.catchTag("Boom", (err) =>
				Effect.succeed(`caught Boom(message="${err.message}")`)
			),
			Effect.catchAll((err) =>
				Effect.succeed(`other remote error: ${JSON.stringify(err)}`)
			)
		);
	}}
>
	Detonate
</button>

{#if outcome}
	<pre>{outcome}</pre>
{/if}

<style>
	pre {
		background: #f4f4f4;
		padding: 0.75rem;
		border-radius: 4px;
	}
</style>
