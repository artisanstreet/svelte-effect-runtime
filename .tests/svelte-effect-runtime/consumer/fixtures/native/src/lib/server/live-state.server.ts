type LiveWaiter = (value: number) => void;

const live_waiters = new Set<LiveWaiter>();

let live_finalizations = 0;
let live_starts = 0;
let live_value = 1;

export function get_live_state(): {
	finalizations: number;
	starts: number;
	value: number;
} {
	return {
		finalizations: live_finalizations,
		starts: live_starts,
		value: live_value,
	};
}

export function record_live_start(): void {
	live_starts += 1;
}

export function record_live_finalization(): void {
	live_finalizations += 1;
}

export function reset_live_state(): void {
	live_value = 1;
	live_starts = 0;
	live_finalizations = 0;
	live_waiters.clear();
}

export function publish_live_value(value: number): void {
	const waiters = [...live_waiters];

	live_value = value;
	live_waiters.clear();

	for (const waiter of waiters) {
		waiter(value);
	}
}

export function next_live_value(): Promise<number> {
	return new Promise((resolve) => {
		live_waiters.add(resolve);
	});
}
