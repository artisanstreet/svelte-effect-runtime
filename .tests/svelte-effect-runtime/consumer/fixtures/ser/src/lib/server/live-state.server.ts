import { Effect } from "effect";

type LiveStart = {
	readonly epoch: number;
	readonly start_id: number;
};

type LiveUpdate = { readonly _tag: "Reset" } | { readonly _tag: "Value"; readonly value: number };

type LiveWaiter = {
	readonly resume: (effect: Effect.Effect<LiveUpdate>) => void;
	readonly start: LiveStart;
};

const live_waiters = new Set<LiveWaiter>();

let live_finalizations = 0;
let live_epoch = 0;
let live_latest_start_id = 0;
let live_next_start_id = 0;
let live_starts = 0;
let live_value = 1;

export const GetLiveState = Effect.gen(function* () {
	const current_waiters = [...live_waiters].filter((waiter) => waiter.start.epoch === live_epoch);
	return yield* Effect.succeed({
		finalizations: live_finalizations,
		ready: current_waiters.some((waiter) => waiter.start.start_id === live_latest_start_id),
		starts: live_starts,
		value: live_value,
		waiters: current_waiters.length,
	});
});

export const RecordLiveStart = Effect.gen(function* () {
	return yield* Effect.sync(() => {
		const start = {
			epoch: live_epoch,
			start_id: ++live_next_start_id,
		};

		live_latest_start_id = start.start_id;
		live_starts += 1;

		return start;
	});
});

export const RecordLiveFinalization = (start: LiveStart) =>
	Effect.gen(function* () {
		yield* Effect.sync(() => {
			if (start.epoch !== live_epoch) {
				return;
			}

			live_finalizations += 1;
		});
	});

export const ResetLiveState = Effect.gen(function* () {
	const waiters = yield* Effect.sync(() => [...live_waiters]);

	yield* Effect.sync(() => {
		live_epoch += 1;
		live_value = 1;
		live_starts = 0;
		live_finalizations = 0;
		live_latest_start_id = 0;
		live_waiters.clear();
	});

	for (const waiter of waiters) {
		yield* Effect.sync(() => waiter.resume(Effect.succeed({ _tag: "Reset" })));
	}
});

export const PublishLiveValue = (value: number) =>
	Effect.gen(function* () {
		const waiters = [...live_waiters].filter((waiter) => waiter.start.epoch === live_epoch);

		yield* Effect.sync(() => {
			live_value = value;
		});

		for (const waiter of waiters) {
			yield* Effect.sync(() => {
				live_waiters.delete(waiter);
				waiter.resume(Effect.succeed({ _tag: "Value", value }));
			});
		}
	});

/** Effect.callback keeps waiter registration and cancellation in one atomic lifecycle boundary. */
export const NextLiveValue = (start: LiveStart) =>
	Effect.callback<LiveUpdate>((resume) => {
		if (start.epoch !== live_epoch) {
			resume(Effect.succeed({ _tag: "Reset" }));

			return Effect.void;
		}

		const waiter = { resume, start };

		live_waiters.add(waiter);

		return Effect.sync(() => live_waiters.delete(waiter));
	});
