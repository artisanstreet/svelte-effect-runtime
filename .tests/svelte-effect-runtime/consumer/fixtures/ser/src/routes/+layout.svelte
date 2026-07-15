<script lang="ts" effect>
	import { type Snippet } from "svelte";
	import { Effect } from "effect";

	let { children }: { children: Snippet } = $props();
	const hydrated = yield* Effect.sync(() => typeof globalThis.window !== "undefined");
</script>

<p data-testid="hydration-ready" hidden>{hydrated}</p>
{@render children()}
