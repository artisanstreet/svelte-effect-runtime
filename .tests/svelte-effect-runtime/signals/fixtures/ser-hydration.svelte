<script lang="ts" effect>
	import { Effect } from "effect";

	interface Props {
		record_event?: (event: string) => void;
	}

	let { record_event }: Props = $props();

	const uid = $props.id();

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

	const script_value = $derived(yield* Environment("script"));
	const opaque = $derived(yield* Opaque);
</script>

<output data-testid="script">{script_value}</output>
<output data-testid="markup">{yield* Environment("markup")}</output>
<output data-testid="opaque">{opaque.label}</output>
<output data-testid="uid">{uid}</output>
