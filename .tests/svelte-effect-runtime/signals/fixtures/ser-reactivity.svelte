<script lang="ts" effect>
	import { Effect } from "effect";

	interface Props {
		resolve_value: (primary: number, secondary: number) => Promise<string>;
	}

	let { resolve_value }: Props = $props();

	let primary = $state(1);
	let secondary = $state(10);

	const ResolveValue = (primary_value: number, secondary_value: number) =>
		Effect.gen(function* () {
			return yield* Effect.promise(() => resolve_value(primary_value, secondary_value));
		});

	const IncrementPrimary = Effect.gen(function* () {
		primary = yield* Effect.succeed(primary + 1);
	});

	const IncrementSecondary = Effect.gen(function* () {
		secondary = yield* Effect.succeed(secondary + 1);
	});

	const resolved_value = $derived(yield* ResolveValue(primary, secondary));
</script>

<button data-testid="primary" onclick={yield* IncrementPrimary}>Primary</button>
<button data-testid="secondary" onclick={yield* IncrementSecondary}>Secondary</button>
<output data-testid="value">{resolved_value}</output>
