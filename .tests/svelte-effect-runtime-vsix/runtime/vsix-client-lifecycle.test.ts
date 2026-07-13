import { MakeSerializedClientControl } from "../../../modules/svelte-effect-runtime-vsix/src/extension/client-lifecycle.ts";
import {
	assert_equals,
	assert_truthy,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Effect, Exit } from "effect";
import { test } from "vitest";

test("VS Code extension deduplicates one server path and replaces a changed path", async () => {
	const events: string[] = [];
	const CreateClient = (server_path: string) =>
		Effect.succeed({
			start: Effect.gen(function* () {
				yield* Effect.sync(() => events.push(`start:${server_path}`));
				yield* Effect.sleep("5 millis");
			}),
			stop: Effect.sync(() => events.push(`stop:${server_path}`)),
			dispose: Effect.sync(() => events.push(`dispose:${server_path}`)),
		});
	const Program = Effect.scoped(
		Effect.gen(function* () {
			const client = yield* MakeSerializedClientControl(CreateClient);

			yield* Effect.all([client.start("first.cjs"), client.start("first.cjs")], {
				concurrency: "unbounded",
				discard: true,
			});
			yield* client.start("second.cjs");
		}),
	);

	await get_server_dispatcher().run(Program);

	assert_equals(events, [
		"start:first.cjs",
		"stop:first.cjs",
		"dispose:first.cjs",
		"start:second.cjs",
		"stop:second.cjs",
		"dispose:second.cjs",
	]);
});

test("VS Code extension replaces a changed path after graceful stop fails", async () => {
	const events: string[] = [];
	const CreateClient = (server_path: string) =>
		Effect.succeed({
			start: Effect.sync(() => events.push(`start:${server_path}`)),
			stop:
				server_path === "first.cjs"
					? Effect.fail(new Error("stop failed"))
					: Effect.sync(() => events.push(`stop:${server_path}`)),
			dispose: Effect.sync(() => events.push(`dispose:${server_path}`)),
		});
	const Program = Effect.scoped(
		Effect.gen(function* () {
			const client = yield* MakeSerializedClientControl(CreateClient);

			yield* client.start("first.cjs");
			yield* client.start("second.cjs");
		}),
	);

	await get_server_dispatcher().run(Program);

	assert_equals(events, [
		"start:first.cjs",
		"dispose:first.cjs",
		"start:second.cjs",
		"stop:second.cjs",
		"dispose:second.cjs",
	]);
});

test("VS Code extension clears a client after explicit stop fails", async () => {
	const client_state = {
		disposes: 0,
		fail_stop: true,
		starts: 0,
		stops: 0,
	};
	const CreateClient = () =>
		Effect.succeed({
			start: Effect.sync(() => {
				client_state.starts += 1;
			}),
			stop: Effect.gen(function* () {
				yield* Effect.sync(() => {
					client_state.stops += 1;
				});

				if (client_state.fail_stop) {
					return yield* Effect.fail(new Error("stop failed"));
				}
			}),
			dispose: Effect.sync(() => {
				client_state.disposes += 1;
			}),
		});
	const Program = Effect.scoped(
		Effect.gen(function* () {
			const client = yield* MakeSerializedClientControl(CreateClient);

			yield* client.start("server.cjs");

			const failed_stop = yield* Effect.exit(client.stop);

			yield* Effect.sync(() => {
				client_state.fail_stop = false;
			});
			yield* client.start("server.cjs");
			yield* client.stop;

			return failed_stop;
		}),
	);
	const stop_exit = await get_server_dispatcher().run(Program);

	assert_truthy(Exit.isFailure(stop_exit));
	assert_equals(client_state.starts, 2);
	assert_equals(client_state.stops, 2);
	assert_equals(client_state.disposes, 2);
});
