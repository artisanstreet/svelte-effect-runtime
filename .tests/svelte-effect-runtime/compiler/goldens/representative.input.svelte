<script lang="ts" effect>
	import { Effect } from "effect";
	const message = "ready";
	const Click = Effect.void;
</script>

{#snippet rendered(value)}
	<span>{value}</span>
{/snippet}

<p>{yield* Effect.succeed(message)}</p>
{#if yield* Effect.succeed(true)}
	<strong>shown</strong>
{/if}
{@html yield* Effect.succeed("<em>html</em>")}
{@render rendered(yield* Effect.succeed("rendered"))}
<button onclick={yield* Click}>go</button>
