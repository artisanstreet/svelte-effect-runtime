<script lang="ts" effect>
	import { Hydratable } from "svelte-effect-runtime/hydratable.ts";
	import { Effect } from "effect";

	interface Props {
		record_event?: (event: string) => void;
	}

	let { record_event }: Props = $props();

	const Environment = (label: string) =>
		Effect.sync(() => {
			record_event?.(label);

			return typeof document === "undefined" ? "server" : "client";
		});

	const Opaque = Effect.sync(() => {
		record_event?.("opaque");

		return {
			label: typeof document === "undefined" ? "server" : "client",
			read: () => "not serializable",
		};
	});

	const script_value = $derived(yield* Hydratable("script", Environment("script")));
	const opaque = $derived(yield* Hydratable("opaque", Opaque));
</script>

<output data-testid="script">{script_value}</output>
<output data-testid="markup">{yield* Hydratable("markup", Environment("markup"))}</output>
<output data-testid="plain">{yield* Environment("plain")}</output>
<output data-testid="opaque">{opaque.label}</output>
