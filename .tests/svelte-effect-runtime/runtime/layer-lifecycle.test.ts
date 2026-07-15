import {
	make_test_request_event,
	reset_test_request_event,
	set_test_request_event,
} from "../unit/fixtures/app-server.ts";
import {
	get_dispatcher,
	reset_dispatcher,
} from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { reset_server_runtime } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Handler, RequestEvent, ServerRuntime } from "svelte-effect-runtime/server";
import { ClientRuntime } from "svelte-effect-runtime";
import { assert_equals, assert_rejects } from "../unit/helpers/assert.ts";
import { Context, Effect, Layer } from "effect";
import { afterEach, test } from "vitest";

afterEach(() => {
	reset_test_request_event();
	reset_server_runtime();
	reset_dispatcher();
});

test("ClientRuntime shares one scoped Layer service across concurrent component work and releases it at shutdown", async () => {
	const ClientProbe = Context.Service<{ readonly identity: number }>("ClientProbe");
	const lifecycle: string[] = [];
	let release_runtime = () => {};
	const runtime_released = new Promise<void>((resolve) => {
		release_runtime = resolve;
	});
	const AcquireProbe = Effect.gen(function* () {
		yield* Effect.sync(() => lifecycle.push("acquired"));

		return { identity: lifecycle.length };
	});
	const ReleaseProbe = Effect.gen(function* () {
		yield* Effect.sync(() => lifecycle.push("released"));
		yield* Effect.sync(release_runtime);
	});
	const ClientProbeLive = Layer.effect(
		ClientProbe,
		Effect.acquireRelease(AcquireProbe, () => ReleaseProbe),
	);
	const ReadProbe = Effect.gen(function* () {
		const probe = yield* ClientProbe;

		return probe.identity;
	});

	ClientRuntime.make(ClientProbeLive);

	const dispatcher = get_dispatcher();
	const identities = await Promise.all([dispatcher.run(ReadProbe), dispatcher.run(ReadProbe)]);

	assert_equals(identities, [1, 1]);
	assert_equals(lifecycle, ["acquired"]);

	reset_dispatcher();
	await runtime_released;

	assert_equals(lifecycle, ["acquired", "released"]);
});

test("ServerRuntime shares one scoped Layer service across concurrent Handlers and releases it at shutdown", async () => {
	type NativeHandler = () => Promise<number>;

	const ServerProbe = Context.Service<{ readonly identity: number }>("ServerProbe");
	const lifecycle: string[] = [];
	let release_runtime = () => {};
	const runtime_released = new Promise<void>((resolve) => {
		release_runtime = resolve;
	});
	const AcquireProbe = Effect.gen(function* () {
		yield* Effect.sync(() => lifecycle.push("acquired"));

		return { identity: lifecycle.length };
	});
	const ReleaseProbe = Effect.gen(function* () {
		yield* Effect.sync(() => lifecycle.push("released"));
		yield* Effect.sync(release_runtime);
	});
	const ServerProbeLive = Layer.effect(
		ServerProbe,
		Effect.acquireRelease(AcquireProbe, () => ReleaseProbe),
	);
	const handler = Handler<NativeHandler>(function* () {
		const probe = yield* ServerProbe;

		return probe.identity;
	});

	ServerRuntime.make(ServerProbeLive);
	set_test_request_event(make_test_request_event("http://localhost/runtime"));

	const identities = await Promise.all([handler(), handler()]);

	assert_equals(identities, [1, 1]);
	assert_equals(lifecycle, ["acquired"]);

	reset_server_runtime();
	await runtime_released;

	assert_equals(lifecycle, ["acquired", "released"]);
});

test("concurrent Handler requests retain their own RequestEvent while execution is interleaved", async () => {
	type NativeHandler = () => Promise<string>;

	let release_first = () => {};
	let release_second = () => {};
	const first_gate = new Promise<void>((resolve) => {
		release_first = resolve;
	});
	const second_gate = new Promise<void>((resolve) => {
		release_second = resolve;
	});
	const handler = Handler<NativeHandler>(function* () {
		const event = yield* RequestEvent;
		const gate = event.url.pathname === "/first" ? first_gate : second_gate;

		yield* Effect.promise(() => gate);

		const retained_event = yield* RequestEvent;

		return retained_event.url.pathname;
	});

	set_test_request_event(make_test_request_event("http://localhost/first"));
	const first_result = handler();

	set_test_request_event(make_test_request_event("http://localhost/second"));
	const second_result = handler();

	release_second();
	release_first();

	assert_equals(await second_result, "/second");
	assert_equals(await first_result, "/first");
});

test("ServerRuntime shutdown interrupts in-flight Handler work and runs its scope finalizer", async () => {
	type NativeHandler = () => Promise<never>;

	let signal_started = () => {};
	let signal_finalized = () => {};
	const started = new Promise<void>((resolve) => {
		signal_started = resolve;
	});
	const finalized = new Promise<void>((resolve) => {
		signal_finalized = resolve;
	});
	const FinalizeRequest = Effect.gen(function* () {
		yield* Effect.sync(signal_finalized);
	});
	const PendingRequest = Effect.gen(function* () {
		yield* Effect.addFinalizer(() => FinalizeRequest);
		yield* Effect.sync(signal_started);

		return yield* Effect.never;
	});
	const handler = Handler<NativeHandler>(() => Effect.scoped(PendingRequest));

	ServerRuntime.make();
	set_test_request_event(make_test_request_event("http://localhost/pending"));

	const request = handler();

	await started;
	reset_server_runtime();
	await finalized;

	const interruption = await assert_rejects(() => request);

	assert_equals(interruption.name, "Error");
	assert_equals(interruption.message, "All fibers interrupted without error");
});
