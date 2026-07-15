type LiveStart = {
	readonly epoch: number;
	readonly start_id: number;
};

type LiveUpdate = { readonly _tag: "Reset" } | { readonly _tag: "Value"; readonly value: number };

type LiveWaiter = {
	readonly resolve: (update: LiveUpdate) => void;
	readonly start: LiveStart;
};

const live_waiters = new Set<LiveWaiter>();

let live_finalizations = 0;
let live_epoch = 0;
let live_latest_start_id = 0;
let live_next_start_id = 0;
let live_starts = 0;
let live_value = 1;

export function get_live_state(): {
	finalizations: number;
	ready: boolean;
	starts: number;
	value: number;
	waiters: number;
} {
	const current_waiters = [...live_waiters].filter((waiter) => waiter.start.epoch === live_epoch);

	return {
		finalizations: live_finalizations,
		ready: current_waiters.some((waiter) => waiter.start.start_id === live_latest_start_id),
		starts: live_starts,
		value: live_value,
		waiters: current_waiters.length,
	};
}

export function record_live_start(): LiveStart {
	const start = {
		epoch: live_epoch,
		start_id: ++live_next_start_id,
	};

	live_latest_start_id = start.start_id;
	live_starts += 1;

	return start;
}

export function record_live_finalization(start: LiveStart): void {
	if (start.epoch !== live_epoch) {
		return;
	}

	live_finalizations += 1;
}

export function reset_live_state(): void {
	const waiters = [...live_waiters];

	live_epoch += 1;
	live_value = 1;
	live_starts = 0;
	live_finalizations = 0;
	live_latest_start_id = 0;
	live_waiters.clear();

	for (const waiter of waiters) {
		waiter.resolve({ _tag: "Reset" });
	}
}

export function publish_live_value(value: number): void {
	const waiters = [...live_waiters].filter((waiter) => waiter.start.epoch === live_epoch);

	live_value = value;

	for (const waiter of waiters) {
		live_waiters.delete(waiter);
		waiter.resolve({ _tag: "Value", value });
	}
}

export function next_live_value(start: LiveStart): Promise<LiveUpdate> {
	if (start.epoch !== live_epoch) {
		return Promise.resolve({ _tag: "Reset" });
	}

	return new Promise((resolve) => {
		live_waiters.add({ resolve, start });
	});
}
