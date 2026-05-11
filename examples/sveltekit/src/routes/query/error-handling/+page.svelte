<script lang="ts" effect>
	import { Effect } from "effect";
	import { failing_query } from "$lib/queries.remote";

	let outcome = $state<string>("");
</script>

<h1>Query — error handling</h1>
<p>
	<code>failing_query</code> fails with a
	<code>Data.TaggedError("DemandedFailure")</code> on the server. The tag and
	payload survive the wire, so the client can recover with
	<code>Effect.catchTag("DemandedFailure", ...)</code> — typed, exhaustive,
	no <code>JSON.stringify</code>-of-cause hacks required.
</p>

<button
	onclick={() => {
		outcome = yield* failing_query("test reason").pipe(
			Effect.catchTag("DemandedFailure", (err) =>
				Effect.succeed(`caught DemandedFailure(reason="${err.reason}")`)
			),
			// Any RemoteFailure variant (HTTP, transport, validation) still in
			// the error channel after catchTag falls through to here.
			Effect.catchAll((err) =>
				Effect.succeed(`other remote error: ${JSON.stringify(err)}`)
			)
		);
	}}
>
	Run failing query
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
