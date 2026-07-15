import {
	get_dispatcher,
	reset_dispatcher,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { ClientRuntime, DispatcherDisposedError } from "svelte-effect-runtime";
import { assert_equals, assert_rejects } from "../unit/helpers/assert.ts";
import { Effect } from "effect";
import { afterEach, test } from "vitest";

afterEach(() => {
	reset_dispatcher();
});

test("a dispatcher cleanup interrupts only its owned fiber while concurrent work can still finish", async () => {
	let signal_first_started = () => {};
	let signal_first_finalized = () => {};
	let signal_second_started = () => {};
	let release_second = () => {};
	const first_started = new Promise<void>((resolve) => {
		signal_first_started = resolve;
	});
	const first_finalized = new Promise<void>((resolve) => {
		signal_first_finalized = resolve;
	});
	const second_started = new Promise<void>((resolve) => {
		signal_second_started = resolve;
	});
	const second_gate = new Promise<void>((resolve) => {
		release_second = resolve;
	});
	const FinalizeFirst = Effect.gen(function* () {
		yield* Effect.sync(signal_first_finalized);
	});
	const First = Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.addFinalizer(() => FinalizeFirst);
			yield* Effect.sync(signal_first_started);

			return yield* Effect.never;
		}),
	);
	const Second = Effect.gen(function* () {
		yield* Effect.sync(signal_second_started);
		yield* Effect.promise(() => second_gate);

		return "second-complete";
	});

	ClientRuntime.make();

	const dispatcher = get_dispatcher();
	const cleanup_first = dispatcher.fork(First);
	const second_result = dispatcher.run(Second);

	await Promise.all([first_started, second_started]);

	cleanup_first();
	await first_finalized;

	release_second();

	assert_equals(await second_result, "second-complete");
});

test("dispatcher shutdown interrupts every owned scope, releases finalizers, and rejects later work", async () => {
	const started_signals: Array<Promise<void>> = [];
	const finalized_signals: Array<Promise<void>> = [];
	const programs: Array<Effect.Effect<never>> = [];
	const finalized_fibers: number[] = [];

	for (const index of [0, 1]) {
		let signal_started = () => {};
		let signal_finalized = () => {};
		const started = new Promise<void>((resolve) => {
			signal_started = resolve;
		});
		const finalized = new Promise<void>((resolve) => {
			signal_finalized = resolve;
		});
		const FinalizeFiber = Effect.gen(function* () {
			yield* Effect.sync(() => finalized_fibers.push(index));
			yield* Effect.sync(signal_finalized);
		});
		const PendingFiber = Effect.scoped(
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => FinalizeFiber);
				yield* Effect.sync(signal_started);

				return yield* Effect.never;
			}),
		);

		started_signals.push(started);
		finalized_signals.push(finalized);
		programs.push(PendingFiber);
	}

	ClientRuntime.make();

	const dispatcher = get_dispatcher();

	for (const program of programs) {
		dispatcher.fork(program);
	}

	await Promise.all(started_signals);
	reset_dispatcher();
	await Promise.all(finalized_signals);

	assert_equals(finalized_fibers.sort(), [0, 1]);

	await assert_rejects(
		() => dispatcher.run(Effect.succeed("unreachable")),
		DispatcherDisposedError,
	);
});
