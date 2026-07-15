import {
	get_dispatcher,
	reset_dispatcher,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { ClientRuntime } from "svelte-effect-runtime";
import { assert_equals } from "../unit/helpers/assert.ts";
import { Data, Effect } from "effect";
import { afterEach, test } from "vitest";

afterEach(() => {
	reset_dispatcher();
});

test("the dispatcher promise bridge keeps success, typed failure, and defect outcomes distinct", async () => {
	class ExpectedFailure extends Data.TaggedError("ExpectedFailure")<{
		readonly detail: string;
	}> {}

	const typed_failure = new ExpectedFailure({ detail: "recoverable" });
	const defect = new Error("unexpected defect");

	ClientRuntime.make();

	const dispatcher = get_dispatcher();
	const success = dispatcher.promise({
		id: "effect-channel-success",
		deps: [],
		factory: function* () {
			return yield* Effect.succeed("success");
		},
	});
	const failure = dispatcher.promise({
		id: "effect-channel-failure",
		deps: [],
		factory: function* () {
			return yield* Effect.fail(typed_failure);
		},
	});
	const died = dispatcher.promise({
		id: "effect-channel-defect",
		deps: [],
		factory: function* () {
			return yield* Effect.die(defect);
		},
	});

	const [success_outcome, failure_outcome, defect_outcome] = await Promise.allSettled([
		success,
		failure,
		died,
	]);

	assert_equals(success_outcome, { status: "fulfilled", value: "success" });
	assert_equals(failure_outcome, { status: "rejected", reason: typed_failure });
	assert_equals(defect_outcome, { status: "rejected", reason: defect });
});

test("the dispatcher promise bridge reports runtime interruption separately from failures and defects", async () => {
	let signal_started = () => {};
	const started = new Promise<void>((resolve) => {
		signal_started = resolve;
	});
	const InterruptedProgram = Effect.gen(function* () {
		yield* Effect.sync(signal_started);

		return yield* Effect.never;
	});

	ClientRuntime.make();

	const dispatcher = get_dispatcher();
	const interrupted = dispatcher.promise({
		id: "effect-channel-interruption",
		deps: [],
		factory: function* () {
			return yield* InterruptedProgram;
		},
	});

	await started;
	reset_dispatcher();

	const outcome = await Promise.allSettled([interrupted]);

	assert_equals(outcome[0].status, "rejected");

	if (outcome[0].status !== "rejected") {
		throw new Error("interrupted dispatcher work should reject");
	}

	assert_equals(outcome[0].reason.name, "Error");
	assert_equals(outcome[0].reason.message, "All fibers interrupted without error");
});
