import {
	assert_command_succeeded,
	get_repo_root,
	run_command,
} from "../public-api/packed-artifact.ts";
import { expect, test } from "vitest";
import { Schema } from "effect";

const LiveState = Schema.Struct({
	finalizations: Schema.Number,
	ready: Schema.Boolean,
	starts: Schema.Number,
	value: Schema.Number,
	waiters: Schema.Number,
});
const LiveStateProbe = Schema.Struct({
	ready: LiveState,
	replay: Schema.Struct({ _tag: Schema.Literal("Value"), value: Schema.Number }),
	reset: Schema.Literal("Reset"),
	reset_ready: LiveState,
	state: LiveState,
});

test("live state exposes subscription readiness and settles pending demand on reset", () => {
	const probe = [
		'import { get_live_state, next_live_value, publish_live_value, record_live_finalization, record_live_start, reset_live_state } from "./.tests/svelte-effect-runtime/consumer/fixtures/native/src/lib/server/live-state.server.ts";',
		'const settle = (promise) => Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve("pending")))]);',
		"reset_live_state();",
		"const replay_generation = record_live_start();",
		"const replay_pending = next_live_value(replay_generation);",
		"const ready = get_live_state();",
		"publish_live_value(2);",
		"const replay = await settle(replay_pending);",
		"record_live_finalization(replay_generation);",
		"reset_live_state();",
		"const reset_generation = record_live_start();",
		"const pending_value = next_live_value(reset_generation);",
		"const reset_ready = get_live_state();",
		"reset_live_state();",
		"const reset = await settle(pending_value.then((update) => update._tag));",
		"record_live_finalization(reset_generation);",
		"console.log(JSON.stringify({ ready, replay, reset_ready, reset, state: get_live_state() }));",
	].join("\n");
	const result = run_command(
		"vp",
		["node", "--input-type=module", "--eval", probe],
		get_repo_root(),
	);

	assert_command_succeeded("probe native live state", result);

	const observation = Schema.decodeUnknownSync(LiveStateProbe)(JSON.parse(result.stdout));

	expect(observation).toEqual({
		ready: { starts: 1, finalizations: 0, ready: true, value: 1, waiters: 1 },
		replay: { _tag: "Value", value: 2 },
		reset_ready: { starts: 1, finalizations: 0, ready: true, value: 1, waiters: 1 },
		reset: "Reset",
		state: { starts: 0, finalizations: 0, ready: false, value: 1, waiters: 0 },
	});
});
