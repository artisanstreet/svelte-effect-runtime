<script lang="ts">
	import {
		FailCommand,
		GetMutation,
		Mutate,
		RedirectCommand,
		SlowCommand,
	} from "$lib/conformance.remote";

	const mutation_resource = GetMutation();

	let command_failure = $state("idle");
	let command_pending = $state("idle");
	let command_redirect = $state("idle");
	let command_result = $state("idle");
	let mutation = $state(await mutation_resource);

	async function mutate() {
		const call = Mutate(1);

		command_pending = String(Mutate.pending);
		const result = await call.updates(mutation_resource);

		if (mutation_resource.ready) {
			mutation = mutation_resource.current;
		}

		command_result = `${result.method}:${result.request_id}:${result.value}`;
		command_pending = String(Mutate.pending);
	}

	async function run_slow_command() {
		const call = SlowCommand();

		command_pending = String(SlowCommand.pending);
		command_result = await call;
		command_pending = String(SlowCommand.pending);
	}

	async function run_failing_command() {
		try {
			await FailCommand();
		} catch (error: unknown) {
			command_failure = normalize_error(error);
		}
	}

	async function run_redirect_command() {
		try {
			await RedirectCommand();
			command_redirect = "unexpected-success";
		} catch (error: unknown) {
			command_redirect = normalize_error(error);
		}
	}

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
<button data-testid="mutate" onclick={mutate}>Mutate</button>
<button data-testid="slow-command" onclick={run_slow_command}>Slow command</button>
<button data-testid="fail-command" onclick={run_failing_command}>Fail command</button>
<button data-testid="redirect-command" onclick={run_redirect_command}>Redirect command</button>
