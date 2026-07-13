import { MakeCoordinatorShutdownGate } from "../../../modules/svelte-effect-runtime-vsix/src/extension/coordinator-lifecycle.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { assert_equals } from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { Effect, Fiber, Option } from "effect";
import { test } from "vitest";

test("VS Code extension shutdown drains active work and rejects queued transitions", async () => {
	const events: string[] = [];
	let enter_transition = () => {};
	let release_transition = () => {};

	const transition_entered = new Promise<void>((resolve) => {
		enter_transition = resolve;
	});
	const transition_release = new Promise<void>((resolve) => {
		release_transition = resolve;
	});
	const Program = Effect.gen(function* () {
		const gate = yield* MakeCoordinatorShutdownGate();
		const active_transition = yield* Effect.forkChild(
			gate.run(
				Effect.gen(function* () {
					yield* Effect.sync(() => {
						events.push("transition:start");
						enter_transition();
					});
					yield* Effect.promise(() => transition_release);
					yield* Effect.sync(() => events.push("transition:end"));

					return "done";
				}),
			),
		);

		yield* Effect.promise(() => transition_entered);

		const shutdown = yield* Effect.forkChild(shutdown_gate_result(gate.close, events));

		yield* gate.await_close;

		const queued_transition = yield* Effect.forkChild(
			gate.run(Effect.sync(() => events.push("queued"))),
		);

		yield* Effect.sync(release_transition);

		const active_result = yield* Fiber.join(active_transition);
		const queued_result = yield* Fiber.join(queued_transition);

		yield* Fiber.join(shutdown);

		return { active_result, queued_result };
	});
	const result = await get_server_dispatcher().run(Program);

	assert_equals(result.active_result, Option.some("done"));
	assert_equals(result.queued_result, Option.none());
	assert_equals(events, ["transition:start", "transition:end", "shutdown:end"]);
});

function shutdown_gate_result(close: Effect.Effect<void>, events: string[]): Effect.Effect<void> {
	return close.pipe(Effect.tap(() => Effect.sync(() => events.push("shutdown:end"))));
}
