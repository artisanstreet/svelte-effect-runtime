import {
	Code,
	Dispatcher,
	get_dispatcher,
	reset_dispatcher,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import {
	RuntimeAlreadyInitializedError,
	ClientRuntime,
} from "../../../modules/svelte-effect-runtime/src/mod.ts";
import { make_dependency_hasher } from "../../../modules/svelte-effect-runtime/src/dispatcher/deps.ts";
import type { ValueOptions } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { assert_equals, assert_throws, assert_rejects } from "../unit/helpers/assert.ts";
import { redirect as svelte_redirect } from "@sveltejs/kit";
import { Effect, Layer, ManagedRuntime } from "effect";
import { test } from "vitest";

/** Construct a fresh dispatcher with a controlled empty-layer runtime. */
function make_dispatcher(): Dispatcher {
	const runtime = ManagedRuntime.make(Layer.empty);

	return new Dispatcher(runtime);
}

/** Small atomic effect that succeeds immediately. */
const Succeed42 = Effect.succeed(42);

test("fork returns a callable cleanup handle", () => {
	const d = make_dispatcher();
	const cleanup = d.fork(Succeed42);

	assert_equals(typeof cleanup, "function");
});

test("fork runs an effect to completion", async () => {
	const d = make_dispatcher();
	let result: string | undefined;

	d.fork(
		Effect.sync(() => {
			result = "ok";
		}),
	);

	await wait_for(() => result === "ok");

	assert_equals(result, "ok");

	d.dispose();
});

test("cleanup interrupts a running fiber", async () => {
	const d = make_dispatcher();
	let started = false;
	let finished = false;

	const Program = Effect.gen(function* () {
		started = true;
		yield* Effect.sleep(60_000);
		finished = true;

		return 42;
	});

	const cleanup = d.fork(Program);

	await wait_for(() => started);

	cleanup();

	await sleep(50);

	if (finished) throw new Error("fiber should have been interrupted");
});

test("calling cleanup twice does not throw", () => {
	const d = make_dispatcher();
	const cleanup = d.fork(Succeed42);

	cleanup();
	cleanup();
});

test("calling cleanup on a finished fiber does not throw", async () => {
	const d = make_dispatcher();
	const cleanup = d.fork(Succeed42);

	await sleep(50);
	cleanup();
});

test("non-interrupt failures surface as uncaught errors", async () => {
	const d = make_dispatcher();
	const errors: unknown[] = [];
	const original_queue = queueMicrotask;
	(globalThis as Record<string, unknown>).queueMicrotask = (fn: () => void) => errors.push(fn);

	try {
		const _cleanup = d.fork(Effect.fail(new Error("expected failure")));
		await sleep(50);

		if (errors.length === 0) throw new Error("expected error to be queued");
	} finally {
		(globalThis as Record<string, unknown>).queueMicrotask = original_queue;
	}
});

test("value returns the fallback synchronously before the effect resolves", () => {
	const d = make_dispatcher();
	let resolve: ((v: string) => void) | undefined;
	const deferred = new Promise<string>((r) => {
		resolve = r;
	});

	const result = d.value({
		id: "test",
		deps: [],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.promise(() => deferred);
		},
	});

	assert_equals(result, "loading");

	resolve!("ok");
	d.dispose();
});

test("value returns the resolved value after the effect completes", () => {
	const d = make_dispatcher();

	const opts: ValueOptions<string> = {
		id: "test-resolve",
		deps: [],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.succeed("resolved");
		},
	};

	d.value(opts);

	const result = d.value(opts);
	assert_equals(result, "resolved");

	d.dispose();
});

test("value treats null as a resolved cached value", () => {
	const d = make_dispatcher();

	const opts: ValueOptions<string | null> = {
		id: "test-null",
		deps: [],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.succeed(null);
		},
	};

	d.value(opts);

	const result = d.value(opts);
	assert_equals(result, null);

	d.dispose();
});

test("value caches the result by id + deps key", () => {
	const d = make_dispatcher();

	const opts: ValueOptions<number> = {
		id: "count",
		deps: [1],
		fallback: 0,
		factory: function* () {
			return yield* Effect.succeed(42);
		},
	};

	d.value(opts);

	const result = d.value(opts);
	assert_equals(result, 42);

	d.dispose();
});

test("value keeps distinct dependency arrays separate", () => {
	const d = make_dispatcher();
	let call_count = 0;

	const first: ValueOptions<string> = {
		id: "collision",
		deps: ["a|s:b"],
		fallback: "loading",
		factory: function* () {
			call_count += 1;
			return yield* Effect.succeed("first");
		},
	};

	const second: ValueOptions<string> = {
		id: "collision",
		deps: ["a", "b"],
		fallback: "loading",
		factory: function* () {
			call_count += 1;
			return yield* Effect.succeed("second");
		},
	};

	d.value(first);
	assert_equals(d.value(first), "first");

	d.value(second);
	assert_equals(d.value(second), "second");
	assert_equals(call_count, 2);

	d.dispose();
});

test("value keeps symbols with the same description separate", () => {
	const d = make_dispatcher();
	const symbol_a = Symbol("same");
	const symbol_b = Symbol("same");

	const first: ValueOptions<string> = {
		id: "symbol-collision",
		deps: [symbol_a],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.succeed("first");
		},
	};

	const second: ValueOptions<string> = {
		id: "symbol-collision",
		deps: [symbol_b],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.succeed("second");
		},
	};

	d.value(first);
	assert_equals(d.value(first), "first");

	d.value(second);
	assert_equals(d.value(second), "second");

	d.dispose();
});

test("value cache ids do not collide with promise cache ids", async () => {
	const d = make_dispatcher();

	const promise = d.promise({
		id: "shared",
		deps: [],
		factory: function* () {
			yield* Effect.sleep("60 seconds");

			return "promise-result";
		},
	});

	const result = d.value({
		id: "promise:shared",
		deps: [],
		fallback: "value-fallback",
		factory: function* () {
			yield* Effect.sleep("60 seconds");

			return "value-result";
		},
	});

	assert_equals(result, "value-fallback");

	d.dispose();
	await promise.catch(() => undefined);
});

test("value keeps primitive and object dependency shapes distinct", () => {
	const d = make_dispatcher();
	const shared_object = { id: 1 };
	let call_count = 0;

	const make_options = (deps: readonly unknown[], value: string): ValueOptions<string> => ({
		id: "dependency-shapes",
		deps,
		fallback: "loading",
		factory: function* () {
			call_count += 1;

			return yield* Effect.succeed(value);
		},
	});

	const cases: Array<[readonly unknown[], string]> = [
		[[null], "null"],
		[[undefined], "undefined"],
		[[1n], "bigint"],
		[[true], "true"],
		[[false], "false"],
		[[shared_object], "object"],
	];

	for (const [deps, value] of cases) {
		const options = make_options(deps, value);

		d.value(options);

		assert_equals(d.value(options), value);
	}

	const shared_again = make_options([shared_object], "object-again");

	assert_equals(d.value(shared_again), "object");

	const distinct_object = make_options([{ id: 1 }], "distinct-object");

	d.value(distinct_object);

	assert_equals(d.value(distinct_object), "distinct-object");
	assert_equals(call_count, 7);

	d.dispose();
});

test("dependency hashers isolate their identity registries", () => {
	const first_hash_deps = make_dependency_hasher();
	const second_hash_deps = make_dependency_hasher();
	const first_object = {};
	const second_object = {};
	const first_symbol = Symbol("first");
	const second_symbol = Symbol("second");
	const first_key = first_hash_deps([first_object, first_symbol]);
	const second_key = second_hash_deps([second_object, second_symbol]);

	assert_equals(first_hash_deps([first_object, first_symbol]), first_key);
	assert_equals(second_hash_deps([second_object, second_symbol]), second_key);
	assert_equals(second_key, first_key);
});

test("value starts a new fiber when deps change", async () => {
	const d = make_dispatcher();
	let call_count = 0;

	const factory = function* () {
		call_count += 1;
		const c = call_count;
		yield* Effect.sleep("10 millis");
		return c;
	};

	const opts1: ValueOptions<number> = {
		id: "dynamic",
		deps: ["a"],
		fallback: 0,
		factory,
	};

	const opts2: ValueOptions<number> = {
		id: "dynamic",
		deps: ["b"],
		fallback: 0,
		factory,
	};

	assert_equals(d.value(opts1), 0);
	await sleep(50);
	assert_equals(d.value(opts1), 1);

	assert_equals(d.value(opts2), 0);
	await sleep(50);
	assert_equals(d.value(opts2), 2);

	assert_equals(d.value(opts1), 1);
});

test("value cancels old fiber when deps change", async () => {
	const d = make_dispatcher();

	let old_finished = false;

	const opts1: ValueOptions<number> = {
		id: "cancel-on-change",
		deps: ["old"],
		fallback: 0,
		factory: function* () {
			yield* Effect.sleep(30);
			old_finished = true;
			return 999;
		},
	};

	const opts2: ValueOptions<number> = {
		id: "cancel-on-change",
		deps: ["new"],
		fallback: 0,
		factory: function* () {
			return yield* Effect.succeed(42);
		},
	};

	/** Start a fiber that would complete in 30ms. */
	d.value(opts1);

	/** Immediately switch deps — the old fiber must be cancelled. */
	d.value(opts2);

	/** Wait longer than the old fiber's sleep so it would have completed if not interrupted. */
	await sleep(100);

	if (old_finished) throw new Error("old fiber should have been interrupted");

	/** The old key must NOT have cached the stale value. */
	const old_result = d.value(opts1);
	if (old_result !== 0) {
		throw new Error(`expected fallback 0, got ${old_result}`);
	}
});

test("value does not fork when disposed", () => {
	const d = make_dispatcher();
	d.dispose();

	let ran = false;

	const result = d.value({
		id: "after-dispose",
		deps: [],
		fallback: "nope",
		factory: function* () {
			ran = true;
			return yield* Effect.succeed("should not run");
		},
	});

	assert_equals(result, "nope");
	if (ran) throw new Error("factory should not have run after dispose");
});

test("value stores failures and throws them during reads", async () => {
	const d = make_dispatcher();
	const original_queue = queueMicrotask;
	const queued: Array<() => void> = [];

	(globalThis as Record<string, unknown>).queueMicrotask = (fn: () => void) => queued.push(fn);

	const options: ValueOptions<string> = {
		id: "value-failure",
		deps: [],
		fallback: "loading",
		factory: function* () {
			return yield* Effect.fail(new Error("value failed"));
		},
	};

	try {
		assert_equals(d.value(options), "loading");

		for (const callback of queued.splice(0)) {
			callback();
		}

		await wait_for(() => {
			try {
				d.value(options);

				return false;
			} catch (error) {
				return error instanceof Error && error.message === "value failed";
			}
		});

		assert_throws(() => d.value(options), Error, "value failed");
		assert_equals(queued.length, 0);
	} finally {
		(globalThis as Record<string, unknown>).queueMicrotask = original_queue;
		d.dispose();
	}
});

test("promise caching remains independent from value caching", async () => {
	const d = make_dispatcher();
	let value_calls = 0;
	let promise_calls = 0;

	const value_options: ValueOptions<string> = {
		id: "shared-public-id",
		deps: [],
		fallback: "loading",
		factory: function* () {
			value_calls += 1;

			return yield* Effect.succeed("value");
		},
	};

	const promise_options = {
		id: "shared-public-id",
		deps: [],
		factory: function* () {
			promise_calls += 1;

			return yield* Effect.succeed("promise");
		},
	};

	d.value(value_options);

	assert_equals(d.value(value_options), "value");
	assert_equals(await d.promise(promise_options), "promise");
	assert_equals(d.value(value_options), "value");
	assert_equals(value_calls, 1);
	assert_equals(promise_calls, 1);

	d.dispose();
});

test("promise returns a Promise that resolves with the effect's value", async () => {
	const d = make_dispatcher();

	const promise = d.promise({
		id: "promise-test",
		deps: [],
		factory: function* () {
			return yield* Effect.succeed(42);
		},
	});

	assert_equals(promise instanceof Promise, true);

	const result = await promise;
	assert_equals(result, 42);
});

test("promise caches by id + deps", async () => {
	const d = make_dispatcher();
	let call_count = 0;

	const opts = {
		id: "promise-cached",
		deps: ["x"],
		factory: function* () {
			call_count += 1;
			return yield* Effect.succeed(call_count);
		},
	};

	const p1 = d.promise(opts);
	const p2 = d.promise(opts);

	assert_equals(p1 === p2, true);

	const result = await p1;
	assert_equals(result, 1);
});

test("promise rejects with the effect's failure", async () => {
	const d = make_dispatcher();

	const promise = d.promise({
		id: "promise-fail",
		deps: [],
		factory: function* () {
			return yield* Effect.fail("expected reject");
		},
	});

	await assert_rejects(() => promise, "expected reject");
});

test("promise is interrupted when dispatcher is disposed", async () => {
	const d = make_dispatcher();

	let completed = false;

	const promise = d.promise({
		id: "pending-promise",
		deps: [],
		factory: function* () {
			yield* Effect.sleep("60 seconds");
			completed = true;

			return "done";
		},
	});

	d.dispose();

	await promise.catch(() => undefined);
	await sleep(30);

	assert_equals(completed, false);
});

test("promise interrupts stale work when deps change", async () => {
	const d = make_dispatcher();

	let stale_completed = false;

	const stale = d.promise({
		id: "dynamic-promise",
		deps: ["old"],
		factory: function* () {
			yield* Effect.sleep("60 seconds");
			stale_completed = true;

			return "old";
		},
	});

	const fresh = d.promise({
		id: "dynamic-promise",
		deps: ["new"],
		factory: function* () {
			return yield* Effect.succeed("new");
		},
	});

	assert_equals(await fresh, "new");

	await stale.catch(() => undefined);
	await sleep(30);

	assert_equals(stale_completed, false);

	d.dispose();
});

test("run returns a Promise that resolves with the effect's value", async () => {
	const d = make_dispatcher();
	const result = await d.run(Succeed42);

	assert_equals(result, 42);
});

test("run returns a Promise that rejects on failure", async () => {
	const d = make_dispatcher();
	const expected_error = new Error("expected error");
	const errors: unknown[] = [];
	const original_queue = queueMicrotask;
	(globalThis as Record<string, unknown>).queueMicrotask = (fn: () => void) => errors.push(fn);

	try {
		const rejection = await assert_rejects(() => d.run(Effect.fail(expected_error)));

		await sleep(50);

		assert_equals(rejection, expected_error);
		assert_equals(errors.length, 1);
	} finally {
		(globalThis as Record<string, unknown>).queueMicrotask = original_queue;
	}
});

test("run suppresses interrupt-only exits", async () => {
	const d = make_dispatcher();
	const errors: unknown[] = [];
	const original_queue = queueMicrotask;
	(globalThis as Record<string, unknown>).queueMicrotask = (fn: () => void) => errors.push(fn);

	try {
		const result = await d.run(Effect.interrupt as Effect.Effect<never, never, never>);

		assert_equals(result, undefined);
		assert_equals(errors, []);
	} finally {
		(globalThis as Record<string, unknown>).queueMicrotask = original_queue;
	}
});

test("run suppresses SvelteKit redirect control flow", async () => {
	const d = make_dispatcher();
	const errors: unknown[] = [];
	const original_queue = queueMicrotask;

	(globalThis as Record<string, unknown>).queueMicrotask = (fn: () => void) => errors.push(fn);

	try {
		const result = await d.run(Effect.sync(() => svelte_redirect(303, "/oauth")));

		assert_equals(result, undefined);
		assert_equals(errors, []);
	} finally {
		(globalThis as Record<string, unknown>).queueMicrotask = original_queue;
	}
});

test("emit runs markup event-handler effects", async () => {
	const d = make_dispatcher();

	const result = await d.emit({
		type: Code.Markup.Run,
		fn: function* () {
			return yield* Effect.succeed(42);
		},
	});

	assert_equals(result, 42);
});

test("emit returns markup value fallback during SSR", () => {
	const d = make_dispatcher();
	let ran = false;

	const result = d.emit({
		type: Code.Markup.Value,
		id: "emit-value",
		deps: [],
		fallback: "fallback",
		fn: function* () {
			ran = true;

			return yield* Effect.succeed("resolved");
		},
	});

	assert_equals(result, "fallback");
	assert_equals(ran, false);
});

test("emit returns markup promise fallback during SSR", async () => {
	const d = make_dispatcher();
	let ran = false;

	const result = await d.emit({
		type: Code.Markup.Promise,
		id: "emit-promise",
		deps: [],
		ssr_fallback: "fallback",
		fn: function* () {
			ran = true;

			return yield* Effect.succeed("resolved");
		},
	});

	assert_equals(result, "fallback");
	assert_equals(ran, false);
});

test("run rejects without executing after dispose", async () => {
	const d = make_dispatcher();
	d.dispose();

	let ran = false;

	await assert_rejects(
		() =>
			d.run(
				Effect.gen(function* () {
					ran = true;

					return yield* Effect.succeed(42);
				}),
			),
		"Dispatcher has been disposed",
	);

	if (ran) throw new Error("run should not execute after dispose");
});

test("dispose does not throw when no fibers are active", () => {
	const d = make_dispatcher();
	d.dispose();
});

test("dispose interrupts all running fibers", async () => {
	const d = make_dispatcher();
	let completed = false;

	d.fork(
		Effect.gen(function* () {
			yield* Effect.sleep(60_000);
			completed = true;
		}),
	);

	await sleep(30);
	d.dispose();
	await sleep(50);

	if (completed) throw new Error("fiber should have been interrupted");
});

test("dispose releases managed runtime layer finalizers", async () => {
	let finalized = false;
	const TestLayer = Layer.effectDiscard(
		Effect.addFinalizer(() =>
			Effect.sync(() => {
				finalized = true;
			}),
		),
	);
	const d = Dispatcher.make(TestLayer);

	await d.run(Effect.void);
	d.dispose();
	await sleep(0);

	assert_equals(finalized, true);
});

test("fork is a no-op after dispose", async () => {
	const d = make_dispatcher();
	d.dispose();

	let ran = false;
	const cleanup = d.fork(
		Effect.gen(function* () {
			ran = true;
			return yield* Effect.succeed(42);
		}),
	);

	assert_equals(typeof cleanup, "function");
	cleanup();

	await sleep(50);
	if (ran) throw new Error("fork should be no-op after dispose");
});

test("value returns fallback after dispose (no fork)", () => {
	const d = make_dispatcher();
	d.dispose();

	const result = d.value({
		id: "post-dispose-value",
		deps: [],
		fallback: "done",
		factory: function* () {
			return yield* Effect.succeed("unreachable");
		},
	});

	assert_equals(result, "done");
});

test("promise rejects after dispose", async () => {
	const d = make_dispatcher();
	d.dispose();

	await assert_rejects(() =>
		d.promise({
			id: "post-dispose-promise",
			deps: [],
			factory: function* () {
				return yield* Effect.succeed(42);
			},
		}),
	);
});

test("get_dispatcher returns the same instance across calls", () => {
	reset_dispatcher();
	const d1 = get_dispatcher();
	const d2 = get_dispatcher();
	assert_equals(d1, d2);
});

test("reset_dispatcher creates a fresh dispatcher", () => {
	reset_dispatcher();
	const d1 = get_dispatcher();
	reset_dispatcher();
	const d2 = get_dispatcher();
	if (d1 === d2) throw new Error("expected fresh dispatcher after reset");
});

test("ClientRuntime.make throws when the client runtime already exists", () => {
	reset_dispatcher();

	try {
		ClientRuntime.make();

		const error = assert_throws(
			() => ClientRuntime.make(),
			RuntimeAlreadyInitializedError,
			"ClientRuntime.make(...) cannot be called",
		);

		assert_equals(error.name, "RuntimeAlreadyInitializedError");
	} finally {
		reset_dispatcher();
	}
});

test("ClientRuntime.make throws after lazy client runtime creation", () => {
	reset_dispatcher();

	try {
		get_dispatcher();

		const error = assert_throws(
			() => ClientRuntime.make(),
			RuntimeAlreadyInitializedError,
			"runtime has already been initialized",
		);

		assert_equals(error.name, "RuntimeAlreadyInitializedError");
	} finally {
		reset_dispatcher();
	}
});

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
