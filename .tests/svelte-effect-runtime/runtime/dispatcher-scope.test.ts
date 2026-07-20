import {
	Dispatcher,
	ComponentScope,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import {
	ScopeDisposedError,
} from "../../../modules/svelte-effect-runtime/src/mod.ts";
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

async function wait_for(predicate: () => boolean, timeout = 1000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) {
			throw new Error("wait_for timed out");
		}
		await sleep(5);
	}
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

	assert_throws(
		() => d2.run_scoped(foreign, Effect.succeed(1)),
		ScopeDisposedError,
	);

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
