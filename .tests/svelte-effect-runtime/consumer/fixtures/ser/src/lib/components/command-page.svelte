<script lang="ts" effect>
	import {
		FailCommand,
		GetMutation,
		Mutate,
		RedirectCommand,
		SlowCommand,
	} from "$lib/conformance.remote";
	import { Effect } from "effect";

	const MutationResource = GetMutation();

	let command_failure = $state("idle");
	let command_pending = $state("idle");
	let command_redirect = $state("idle");
	let command_result = $state("idle");
	let mutation = $state(yield* MutationResource);

	const MutateValue = Effect.gen(function* () {
		const Call = Mutate(1);

		command_pending = String(Mutate.pending);
		const result = yield* Call.updates(MutationResource);

		if (MutationResource.ready) {
			mutation = MutationResource.current;
		}

		command_result = `${result.method}:${result.request_id}:${result.value}`;
		command_pending = String(Mutate.pending);
	});

	const RunSlowCommand = Effect.gen(function* () {
		const Call = SlowCommand();

		command_pending = String(SlowCommand.pending);
		command_result = yield* Call;
		command_pending = String(SlowCommand.pending);
	});

	const RunFailingCommand = Effect.gen(function* () {
		command_failure = yield* FailCommand().pipe(
			Effect.match({
				onFailure: normalize_error,
				onSuccess: () => "unexpected-success",
			}),
		);
	});

	const RunRedirectCommand = Effect.gen(function* () {
		command_redirect = yield* RedirectCommand().pipe(
			Effect.match({
				onFailure: normalize_error,
				onSuccess: () => "unexpected-success",
			}),
		);
	});

	function normalize_error(error: unknown): string {
		if (!error || typeof error !== "object") {
			return String(error);
		}

		const value = error as {
			body?: { message?: string };
			message?: string;
			status?: number;
		};

		return `${value.status ?? 0}:${value.body?.message ?? value.message ?? "unknown"}`;
	}
</script>

<p data-testid="mutation">{mutation.value}</p>
<p data-testid="command-result">{command_result}</p>
<p data-testid="command-pending">{command_pending}</p>
<p data-testid="command-failure">{command_failure}</p>
<p data-testid="command-redirect">{command_redirect}</p>
<button data-testid="mutate" onclick={yield* MutateValue}>Mutate</button>
<button data-testid="slow-command" onclick={yield* RunSlowCommand}>Slow command</button>
<button data-testid="fail-command" onclick={yield* RunFailingCommand}>Fail command</button>
<button data-testid="redirect-command" onclick={yield* RunRedirectCommand}>
	Redirect command
</button>
