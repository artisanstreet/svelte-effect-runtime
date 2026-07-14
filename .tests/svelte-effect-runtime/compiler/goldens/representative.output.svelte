<script lang="ts" effect>
	import { Effect } from "effect";
	const message = "ready";
	const Click = Effect.void;

import { Dispatcher, Code, ToEffect } from "svelte-effect-runtime/internal/generators";
function* __SER___markup_effect_190_220() { return (yield* ToEffect(Effect.succeed(message))); }
function* __SER___markup_effect_231_258() { return (yield* ToEffect(Effect.succeed(true))); }
function* __SER___markup_effect_355_388() { return (yield* ToEffect(Effect.succeed("rendered"))); }
</script>

{#snippet rendered(value)}
	<span>{value}</span>
{/snippet}

<p>{await Dispatcher.emit({ type: Code.Markup.Promise, id: "Representative.svelte:190:220", deps: [Effect, message], fn: () => __SER___markup_effect_190_220() })}</p>
{#if await Dispatcher.emit({ type: Code.Markup.Promise, id: "Representative.svelte:231:258", deps: [Effect], fn: () => __SER___markup_effect_231_258() })}
	<strong>shown</strong>
{/if}
{@html await Dispatcher.emit({ type: Code.Markup.Promise, id: "Representative.svelte:297:335", deps: [Effect], fn: () => (function* () { return (yield* ToEffect(Effect.succeed("<em>html</em>"))); })() })}
{@render rendered(await Dispatcher.emit({ type: Code.Markup.Promise, id: "Representative.svelte:355:388", deps: [Effect], fn: () => __SER___markup_effect_355_388() }))}
<button onclick={(event) => { Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* ToEffect(Click); } }); }}>go</button>
