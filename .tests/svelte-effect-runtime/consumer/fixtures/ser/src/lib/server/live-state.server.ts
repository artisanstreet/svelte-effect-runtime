import { Effect } from "effect";

type LiveWaiter = (value: number) => void;

const live_waiters = new Set<LiveWaiter>();

let live_finalizations = 0;
let live_starts = 0;
let live_value = 1;

export const GetLiveState = Effect.gen(function* () {
	return {
		finalizations: live_finalizations,
		starts: live_starts,
		value: live_value,
	};
});

export const RecordLiveStart = Effect.gen(function* () {
	yield* Effect.sync(() => {
		live_starts += 1;
	});
});

export const RecordLiveFinalization = Effect.gen(function* () {
	yield* Effect.sync(() => {
		live_finalizations += 1;
	});
});

export const ResetLiveState = Effect.gen(function* () {
	yield* Effect.sync(() => {
		live_value = 1;
		live_starts = 0;
		live_finalizations = 0;
		live_waiters.clear();
	});
});

export const PublishLiveValue = (value: number) =>
	Effect.gen(function* () {
		const waiters = [...live_waiters];

		yield* Effect.sync(() => {
			live_value = value;
			live_waiters.clear();
		});

		for (const waiter of waiters) {
			yield* Effect.sync(() => waiter(value));
		}
	});

export const NextLiveValue = Effect.callback<number>((resume) => {
	const waiter = (value: number) => resume(Effect.succeed(value));

	live_waiters.add(waiter);

	return Effect.sync(() => live_waiters.delete(waiter));
});
