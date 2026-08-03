import {
	ComponentScope,
	Dispatcher,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import {
	DispatcherDisposedError,
	ScopeDisposedError,
} from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, test } from "vitest";

import * as fc from "fast-check";

/**
 * Randomised lifecycle sequences over the dispatcher.
 *
 * Component teardown, scope disposal and fiber interruption interleave in
 * orders no hand-written test enumerates, and the failure mode is a leak: a
 * fiber that outlives the component that started it keeps running against
 * state that no longer exists. The properties below assert the lifecycle
 * invariants rather than any particular ordering.
 */

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 150);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 200);

type Operation =
	| { readonly kind: "begin_scope" }
	| { readonly kind: "run_scoped"; readonly scope: number }
	| { readonly kind: "dispose_scope"; readonly scope: number }
	| { readonly kind: "cleanup"; readonly handle: number }
	| { readonly kind: "promise"; readonly id: number }
	| { readonly kind: "value"; readonly id: number }
	| { readonly kind: "dispose" };

const operation_arbitrary: fc.Arbitrary<Operation> = fc.oneof(
	fc.constant<Operation>({ kind: "begin_scope" }),
	fc.nat({ max: 5 }).map((scope) => ({ kind: "run_scoped", scope }) as const),
	fc.nat({ max: 5 }).map((scope) => ({ kind: "dispose_scope", scope }) as const),
	fc.nat({ max: 5 }).map((handle) => ({ kind: "cleanup", handle }) as const),
	fc.nat({ max: 3 }).map((id) => ({ kind: "promise", id }) as const),
	fc.nat({ max: 3 }).map((id) => ({ kind: "value", id }) as const),
	fc.constant<Operation>({ kind: "dispose" }),
);

const sequence_arbitrary = fc.array(operation_arbitrary, { minLength: 1, maxLength: 24 });

interface RunState {
	readonly scopes: ComponentScope[];
	readonly cleanups: Array<() => void>;
	readonly pending: Array<Promise<unknown>>;
	disposed: boolean;
}

/**
 * The dispatcher documents exactly two refusals. Anything else escaping a
 * lifecycle call is a defect, not a contract.
 */
function is_documented_refusal(issue: unknown): boolean {
	return issue instanceof ScopeDisposedError || issue instanceof DispatcherDisposedError;
}

async function run_sequence(operations: readonly Operation[]): Promise<{
	dispatcher: Dispatcher;
	state: RunState;
	undocumented: string[];
}> {
	const dispatcher = new Dispatcher(ManagedRuntime.make(Layer.empty));
	const state: RunState = { scopes: [], cleanups: [], pending: [], disposed: false };
	const undocumented: string[] = [];

	const attempt = (label: string, action: () => void): void => {
		try {
			action();
		} catch (issue) {
			if (!is_documented_refusal(issue)) {
				undocumented.push(
					`${label}: ${issue instanceof Error ? `${issue.name}: ${issue.message}` : String(issue)}`,
				);
			}
		}
	};

	for (const [index, operation] of operations.entries()) {
		const label = `${index}:${operation.kind}`;

		switch (operation.kind) {
			case "begin_scope":
				attempt(label, () => {
					state.scopes.push(dispatcher.begin_scope());
				});
				break;

			case "run_scoped": {
				const scope = state.scopes[operation.scope % Math.max(state.scopes.length, 1)];

				if (!scope) {
					break;
				}

				attempt(label, () => {
					state.cleanups.push(dispatcher.run_scoped(scope, Effect.never));
				});
				break;
			}

			case "dispose_scope": {
				const scope = state.scopes[operation.scope % Math.max(state.scopes.length, 1)];

				if (!scope) {
					break;
				}

				attempt(label, () => dispatcher.dispose_scope(scope));
				break;
			}

			case "cleanup": {
				const cleanup =
					state.cleanups[operation.handle % Math.max(state.cleanups.length, 1)];

				if (!cleanup) {
					break;
				}

				attempt(label, () => cleanup());
				break;
			}

			case "promise":
				attempt(label, () => {
					state.pending.push(
						dispatcher
							.promise({
								id: `promise-${operation.id}`,
								deps: [],
								factory: function* () {
									return yield* Effect.succeed(operation.id);
								},
							})
							.catch(() => undefined),
					);
				});
				break;

			case "value":
				attempt(label, () => {
					dispatcher.value({
						id: `value-${operation.id}`,
						deps: [],
						factory: function* () {
							return yield* Effect.succeed(operation.id);
						},
						fallback: null,
					});
				});
				break;

			case "dispose":
				attempt(label, () => dispatcher.dispose());
				state.disposed = true;
				break;
		}
	}

	await Promise.all(state.pending);

	return { dispatcher, state, undocumented };
}

test(
	"no lifecycle sequence produces an undocumented failure",
	async () => {
		await fc.assert(
			fc.asyncProperty(sequence_arbitrary, async (operations) => {
				const { dispatcher, undocumented } = await run_sequence(operations);

				dispatcher.dispose();

				expect(undocumented, JSON.stringify(operations)).toEqual([]);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Disposing the dispatcher is component teardown. A scope that survives it
 * owns fibers nothing will ever interrupt.
 */
test(
	"disposing the dispatcher disposes every scope it handed out",
	async () => {
		await fc.assert(
			fc.asyncProperty(sequence_arbitrary, async (operations) => {
				const { dispatcher, state } = await run_sequence(operations);

				dispatcher.dispose();

				const survivors = state.scopes.filter((scope) => !scope.disposed);

				expect(survivors.length, JSON.stringify(operations)).toBe(0);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"disposal is idempotent for scopes, cleanups and the dispatcher",
	async () => {
		await fc.assert(
			fc.asyncProperty(sequence_arbitrary, async (operations) => {
				const { dispatcher, state, undocumented } = await run_sequence(operations);

				for (const cleanup of state.cleanups) {
					expect(() => {
						cleanup();
						cleanup();
					}, JSON.stringify(operations)).not.toThrow();
				}

				expect(() => {
					dispatcher.dispose();
					dispatcher.dispose();
				}, JSON.stringify(operations)).not.toThrow();

				for (const scope of state.scopes) {
					expect(() => {
						scope.dispose();
						scope.dispose();
					}).not.toThrow();
				}

				expect(undocumented).toEqual([]);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Confirms the generated sequences actually reach the states the properties
 * are about. A sequence arbitrary that mostly produced no-ops would leave every
 * property above passing while testing nothing.
 */
test("generated sequences reach the states under test", async () => {
	const sequences = fc.sample(sequence_arbitrary, { numRuns: 200, seed: 11 });

	let with_scopes = 0;
	let with_cleanups = 0;
	let with_disposed_scope = 0;
	let with_dispatcher_dispose = 0;

	for (const operations of sequences) {
		const { dispatcher, state } = await run_sequence(operations);

		if (state.scopes.length > 0) with_scopes += 1;
		if (state.cleanups.length > 0) with_cleanups += 1;
		if (state.scopes.some((scope) => scope.disposed)) with_disposed_scope += 1;
		if (state.disposed) with_dispatcher_dispose += 1;

		dispatcher.dispose();
	}

	expect({
		with_scopes: with_scopes > 20,
		with_cleanups: with_cleanups > 20,
		with_disposed_scope: with_disposed_scope > 20,
		with_dispatcher_dispose: with_dispatcher_dispose > 20,
	}).toEqual({
		with_scopes: true,
		with_cleanups: true,
		with_disposed_scope: true,
		with_dispatcher_dispose: true,
	});
});

test(
	"a scope from one dispatcher is refused by another",
	() => {
		fc.assert(
			fc.property(fc.nat({ max: 4 }), (count) => {
				const owner = new Dispatcher(ManagedRuntime.make(Layer.empty));
				const stranger = new Dispatcher(ManagedRuntime.make(Layer.empty));

				const scopes = Array.from({ length: count + 1 }, () => owner.begin_scope());

				for (const scope of scopes) {
					expect(() => stranger.run_scoped(scope, Effect.never)).toThrow(
						ScopeDisposedError,
					);
					expect(() => stranger.dispose_scope(scope)).toThrow(ScopeDisposedError);
				}

				owner.dispose();
				stranger.dispose();
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);
