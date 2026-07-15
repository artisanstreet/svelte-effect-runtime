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
	let command_redirect = $state("idle");
	let command_result = $state("idle");
	let mutation = $state(yield* MutationResource);

	const MutateValue = Effect.gen(function* () {
		const Call = Mutate(1);

		const result = yield* Call;

		yield* MutationResource.refresh();
		mutation = yield* MutationResource;

		command_result = `${result.method}:${result.request_id}:${result.value}`;
	});

	const RunSlowCommand = Effect.gen(function* () {
		const Call = SlowCommand();

		command_result = yield* Call;
	});

	const RunFailingCommand = Effect.gen(function* () {
		command_failure = yield* FailCommand().pipe(
			Effect.matchEffect({
				onFailure: NormalizeError,
				onSuccess: () =>
					Effect.gen(function* () {
						return "unexpected-success";
					}),
			}),
		);
	});

	const RunRedirectCommand = Effect.gen(function* () {
		command_redirect = yield* RedirectCommand().pipe(
			Effect.matchEffect({
				onFailure: NormalizeError,
				onSuccess: () =>
					Effect.gen(function* () {
						return "unexpected-success";
					}),
			}),
		);
	});

	const NormalizeError = (error: unknown) =>
		Effect.gen(function* () {
			if (!error || typeof error !== "object") {
				return String(error);
			}

			const body = Reflect.get(error, "body");
			const body_message =
				body && typeof body === "object" ? Reflect.get(body, "message") : undefined;
			const cause = Reflect.get(error, "cause");
			const cause_message =
				cause && typeof cause === "object" ? Reflect.get(cause, "message") : undefined;
			const message = Reflect.get(error, "message");
			const status = Reflect.get(error, "status");

			return `${typeof status === "number" ? status : 0}:${typeof body_message === "string" ? body_message : typeof message === "string" ? message : typeof cause_message === "string" ? cause_message : "unknown"}`;
		});
</script>

<p data-testid="mutation">{mutation.value}</p>
<p data-testid="command-result">{command_result}</p>
<p data-testid="command-pending">{SlowCommand.pending}</p>
<p data-testid="command-failure">{command_failure}</p>
<p data-testid="command-redirect">{command_redirect}</p>
<button data-testid="mutate" onclick={yield* MutateValue}>Mutate</button>
<button data-testid="slow-command" onclick={yield* RunSlowCommand}>Slow command</button>
<button data-testid="fail-command" onclick={yield* RunFailingCommand}>Fail command</button>
<button data-testid="redirect-command" onclick={yield* RunRedirectCommand}>
	Redirect command
</button>
