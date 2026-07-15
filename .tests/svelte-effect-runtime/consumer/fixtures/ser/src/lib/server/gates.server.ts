import { Effect } from "effect";

type Gate = {
	promise: Promise<void>;
	release: () => void;
	released: boolean;
	waiting: number;
};

const gates = new Map<string, Gate>();

export const ResetGate = (name: string) =>
	Effect.gen(function* () {
		const existing = gates.get(name);

		yield* Effect.sync(() => existing?.release());

		let release = () => {};
		const promise = new Promise<void>((resolve) => {
			release = resolve;
		});

		yield* Effect.sync(() =>
			gates.set(name, {
				promise,
				release,
				released: false,
				waiting: 0,
			}),
		);
	});

export const WaitForGate = (name: string) =>
	Effect.gen(function* () {
		const gate = gates.get(name);

		if (!gate) {
			return;
		}

		yield* Effect.sync(() => {
			gate.waiting += 1;
		});
		yield* Effect.promise(() => gate.promise);
	});

export const ReleaseGate = (name: string) =>
	Effect.gen(function* () {
		const gate = gates.get(name);

		if (!gate || gate.released) {
			return;
		}

		yield* Effect.sync(() => {
			gate.released = true;
			gate.release();
		});
	});

export const GetGateStatus = (name: string) =>
	Effect.gen(function* () {
		const gate = gates.get(name);

		return {
			released: gate?.released ?? true,
			waiting: gate?.waiting ?? 0,
		};
	});
