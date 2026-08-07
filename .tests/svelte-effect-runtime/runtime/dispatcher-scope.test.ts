import {
	Dispatcher,
	ComponentScope,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { ScopeDisposedError } from "../../../modules/svelte-effect-runtime/src/mod.ts";
import { assert_equals, assert_throws } from "../unit/helpers/assert.ts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { test } from "vitest";

/** Construct a fresh dispatcher with a controlled empty-layer runtime. */
function make_dispatcher(): Dispatcher {
	const runtime = ManagedRuntime.make(Layer.empty);

	return new Dispatcher(runtime);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function component_finalizer_count(scope: ComponentScope): number {
	const state = scope.underlying.state;

	return state._tag === "Open" ? state.finalizers.size : 0;
}

async function wait_for(predicate: () => boolean, timeout = 1000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) {
			throw new Error("wait_for timed out");
		}
		await sleep(5);
	}
}

async function assert_failed_run_closes_children(
	failure: Effect.Effect<never, unknown>,
): Promise<void> {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	const baseline_finalizers = component_finalizer_count(scope);
	let child_started = false;
	let child_finalizers = 0;
	let finalizer_exit: string | undefined;

	const Child = Effect.gen(function* () {
		yield* Effect.addFinalizer((exit) =>
			Effect.sync(() => {
				child_finalizers += 1;
				finalizer_exit = exit._tag;
			}),
		);
		child_started = true;
		yield* Effect.never;
	});
	const Program = Effect.gen(function* () {
		yield* Child.pipe(Effect.forkScoped);

		while (!child_started) {
			yield* Effect.yieldNow;
		}

		return yield* failure;
	});

	const cleanup = d.run_scoped(scope, Program);

	await wait_for(() => child_started);
	await wait_for(() => child_finalizers === 1);
	await wait_for(() => component_finalizer_count(scope) === baseline_finalizers);

	cleanup();
	cleanup();
	await sleep(20);

	assert_equals(child_finalizers, 1);
	assert_equals(finalizer_exit, "Failure");
	assert_equals(component_finalizer_count(scope), baseline_finalizers);

	d.dispose();
}

test("begin_scope returns a component scope bound to the dispatcher", () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();

	assert_equals(scope instanceof ComponentScope, true);
	assert_equals(scope.disposed, false);

	d.dispose();
});

test("run_scoped returns a callable cleanup handle", () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	const cleanup = d.run_scoped(scope, Effect.succeed(42));

	assert_equals(typeof cleanup, "function");

	d.dispose_scope(scope);
	d.dispose();
});

test("disposing a scope runs finalizers of in-flight scoped work", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let started = false;
	let finalized = false;

	const Program = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				finalized = true;
			}),
		);
		started = true;
		yield* Effect.sleep(60_000);
	});

	d.run_scoped(scope, Program);

	await wait_for(() => started);

	d.dispose_scope(scope);

	await wait_for(() => finalized);

	d.dispose();
});

test("dispose_scope is idempotent", () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();

	d.dispose_scope(scope);
	d.dispose_scope(scope);

	assert_equals(scope.disposed, true);
	d.dispose();
});

test("run_scoped cleanup interrupts a running scoped fiber", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let started = false;
	let finished = false;

	const Program = Effect.gen(function* () {
		started = true;
		yield* Effect.sleep(60_000);
		finished = true;
	});

	const cleanup = d.run_scoped(scope, Program);

	await wait_for(() => started);

	cleanup();

	await sleep(50);

	if (finished) throw new Error("scoped fiber should have been interrupted");

	d.dispose();
});

test("run_scoped cleanup closes forkScoped children after setup completes", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	const baseline_finalizers = component_finalizer_count(scope);
	let child_started = false;
	let child_finalizers = 0;
	let setup_completed = false;

	const Child = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				child_finalizers += 1;
			}),
		);
		child_started = true;
		yield* Effect.never;
	});
	const Program = Effect.gen(function* () {
		yield* Child.pipe(Effect.forkScoped);
		setup_completed = true;
	});

	const cleanup = d.run_scoped(scope, Program);

	await wait_for(() => child_started && setup_completed);
	await sleep(20);

	assert_equals(child_finalizers, 0);

	cleanup();
	cleanup();

	await wait_for(() => child_finalizers === 1);
	await wait_for(() => component_finalizer_count(scope) === baseline_finalizers);
	await sleep(20);

	assert_equals(child_finalizers, 1);
	assert_equals(component_finalizer_count(scope), baseline_finalizers);

	d.dispose();
});

test("run_scoped cleanup isolates concurrent reactive run children", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	const baseline_finalizers = component_finalizer_count(scope);
	const active_runs = new Set<number>();
	const finalized_runs = new Set<number>();

	const MakeProgram = (run_id: number) =>
		Effect.gen(function* () {
			yield* Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						active_runs.delete(run_id);
						finalized_runs.add(run_id);
					}),
				);
				active_runs.add(run_id);
				yield* Effect.never;
			}).pipe(Effect.forkScoped);
		});

	const cleanup_first = d.run_scoped(scope, MakeProgram(1));
	const cleanup_second = d.run_scoped(scope, MakeProgram(2));

	await wait_for(() => active_runs.size === 2);

	cleanup_first();

	await wait_for(() => finalized_runs.has(1));

	assert_equals(active_runs.has(1), false);
	assert_equals(active_runs.has(2), true);
	assert_equals(finalized_runs.has(2), false);

	cleanup_second();

	await wait_for(() => finalized_runs.size === 2);
	await wait_for(() => component_finalizer_count(scope) === baseline_finalizers);

	assert_equals(component_finalizer_count(scope), baseline_finalizers);

	d.dispose();
});

test("reactive rerun cleanup keeps component finalizers bounded", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	const baseline_finalizers = component_finalizer_count(scope);
	const run_count = 128;
	let active_children = 0;
	let finalized_children = 0;

	const Child = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				active_children -= 1;
				finalized_children += 1;
			}),
		);
		active_children += 1;
		yield* Effect.never;
	});
	const Program = Effect.gen(function* () {
		yield* Child.pipe(Effect.forkScoped);
	});

	/** Repeatedly model Svelte invalidating the previous completed setup run. */
	for (let index = 0; index < run_count; index += 1) {
		const cleanup = d.run_scoped(scope, Program);

		await wait_for(() => active_children === 1);
		cleanup();
		await wait_for(() => finalized_children === index + 1);
		await wait_for(() => component_finalizer_count(scope) === baseline_finalizers);

		assert_equals(active_children, 0);
	}

	assert_equals(finalized_children, run_count);
	assert_equals(component_finalizer_count(scope), baseline_finalizers);

	d.dispose();
});

test("component disposal closes forkScoped children from completed reactive setup", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let child_started = false;
	let child_finalized = false;

	const Child = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				child_finalized = true;
			}),
		);
		child_started = true;
		yield* Effect.never;
	});
	const Program = Effect.gen(function* () {
		yield* Child.pipe(Effect.forkScoped);
	});

	d.run_scoped(scope, Program);

	await wait_for(() => child_started);

	d.dispose_scope(scope);

	await wait_for(() => child_finalized);

	assert_equals(scope.disposed, true);

	d.dispose();
});

test("run_scoped closes forkScoped children after a typed setup failure", async () => {
	await assert_failed_run_closes_children(Effect.fail("expected failure"));
});

test("run_scoped closes forkScoped children after a setup defect", async () => {
	await assert_failed_run_closes_children(Effect.die("expected defect"));
});

test("run_scoped throws ScopeDisposedError after the scope is disposed", () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();

	d.dispose_scope(scope);

	const error = assert_throws(
		() => d.run_scoped(scope, Effect.succeed(1)),
		ScopeDisposedError,
		"Effect scope has been disposed",
	);

	assert_equals(error.name, "ScopeDisposedError");
	d.dispose();
});

test("run_scoped rejects a scope that belongs to another dispatcher", () => {
	const d1 = make_dispatcher();
	const d2 = make_dispatcher();
	const foreign = d1.begin_scope();

	assert_throws(() => d2.run_scoped(foreign, Effect.succeed(1)), ScopeDisposedError);

	d1.dispose();
	d2.dispose();
});

test("run_scoped is a no-op after the dispatcher is disposed", () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();

	d.dispose();

	const cleanup = d.run_scoped(scope, Effect.succeed(1));

	assert_equals(typeof cleanup, "function");
	cleanup();
});

test("disposing the dispatcher runs finalizers of open component scopes", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let finalized = false;

	const Program = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				finalized = true;
			}),
		);
		yield* Effect.sleep(60_000);
	});

	d.run_scoped(scope, Program);

	await sleep(20);

	d.dispose();

	await wait_for(() => finalized);
});

test("run_scoped cleanup interrupts the scoped fiber, not just the awaiter", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let finished = false;

	const Program = Effect.flatMap(Effect.sleep(60_000), () =>
		Effect.sync(() => {
			finished = true;
		}),
	);

	const cleanup = d.run_scoped(scope, Program);

	await sleep(20);

	cleanup();

	// The scoped fiber must be interrupted (never reach completion).
	await sleep(100);

	if (finished) {
		throw new Error("scoped fiber should have been interrupted by the cleanup");
	}

	d.dispose();
});

test("dispose_scope rejects an open scope owned by another dispatcher", () => {
	const d1 = make_dispatcher();
	const d2 = make_dispatcher();
	const foreign = d1.begin_scope();

	assert_throws(() => d2.dispose_scope(foreign), ScopeDisposedError);

	// The foreign scope is left untouched and still owned by d1.
	assert_equals(foreign.disposed, false);

	d1.dispose();
	d2.dispose();
});

test("dispose_scope is a no-op for a foreign scope that is already disposed", () => {
	const d1 = make_dispatcher();
	const d2 = make_dispatcher();
	const foreign = d1.begin_scope();

	d1.dispose_scope(foreign);
	d2.dispose_scope(foreign);

	assert_equals(foreign.disposed, true);
	d1.dispose();
	d2.dispose();
});

test("with_scope routes promise work into the component scope", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let finalized = false;

	const promise = d.with_scope(scope, () =>
		d.promise({
			id: "scoped-promise",
			deps: [],
			factory: () =>
				(function* () {
					yield* Effect.acquireRelease(Effect.void, () =>
						Effect.sync(() => {
							finalized = true;
						}),
					);
					yield* Effect.sleep(60_000);
				})(),
		}),
	);

	void promise.catch(() => {});

	await sleep(20);

	d.dispose_scope(scope);

	await wait_for(() => finalized);

	d.dispose();
});

test("with_scope routes run work into the component scope", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let finalized = false;

	const Program = Effect.gen(function* () {
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				finalized = true;
			}),
		);
		yield* Effect.sleep(60_000);
	});

	void d.with_scope(scope, () => d.run(Program)).catch(() => {});

	await sleep(20);

	d.dispose_scope(scope);

	await wait_for(() => finalized);

	d.dispose();
});

test("with_scope routes value work into the component scope", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let finalized = false;

	d.with_scope(scope, () =>
		d.value({
			id: "scoped-value",
			deps: [],
			fallback: undefined,
			factory: () =>
				(function* () {
					yield* Effect.acquireRelease(Effect.void, () =>
						Effect.sync(() => {
							finalized = true;
						}),
					);
					yield* Effect.sleep(60_000);
				})(),
		}),
	);

	await sleep(20);

	d.dispose_scope(scope);

	await wait_for(() => finalized);

	d.dispose();
});

test("execution outside with_scope is not bound to any component scope", async () => {
	const d = make_dispatcher();
	const scope = d.begin_scope();
	let started = false;
	let interrupted = false;

	const Program = Effect.gen(function* () {
		started = true;
		yield* Effect.sleep(60_000);
	}).pipe(
		Effect.onInterrupt(() =>
			Effect.sync(() => {
				interrupted = true;
			}),
		),
	);

	/** No with_scope: the run is not owned by the component scope. */
	void d.run(Program).catch(() => {});

	await wait_for(() => started);

	d.dispose_scope(scope);

	/** The unscoped run must survive the component scope disposal. */
	await sleep(50);

	if (interrupted) {
		throw new Error("unscoped run should not be interrupted by the component scope");
	}

	d.dispose();
});
