type Gate = {
	promise: Promise<void>;
	release: () => void;
	released: boolean;
	waiting: number;
};

const gates = new Map<string, Gate>();

export function reset_gate(name: string): void {
	const existing = gates.get(name);

	existing?.release();

	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});

	gates.set(name, {
		promise,
		release,
		released: false,
		waiting: 0,
	});
}

export async function wait_for_gate(name: string): Promise<void> {
	const gate = gates.get(name);

	if (!gate) {
		return;
	}

	gate.waiting += 1;

	await gate.promise;
}

export function release_gate(name: string): void {
	const gate = gates.get(name);

	if (!gate || gate.released) {
		return;
	}

	gate.released = true;
	gate.release();
}

export function get_gate_status(name: string): { released: boolean; waiting: number } {
	const gate = gates.get(name);

	return {
		released: gate?.released ?? true,
		waiting: gate?.waiting ?? 0,
	};
}
