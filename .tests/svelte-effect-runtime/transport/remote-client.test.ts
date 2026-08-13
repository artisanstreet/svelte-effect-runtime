import {
	create_remote_live_query_adapter,
	create_remote_prerender_adapter,
	create_remote_command_adapter,
	create_remote_query_adapter,
	create_remote_form_adapter,
} from "../../../modules/svelte-effect-runtime/src/remote/client.ts";
import {
	get_server_dispatcher,
	reset_server_runtime,
} from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { create_serialized_remote_failure_envelope } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";
import { make_remote_live_snapshot_encoder } from "../../../modules/svelte-effect-runtime/src/server/live-snapshot.ts";
import { normalize_native_error } from "../../../modules/svelte-effect-runtime/src/remote/failures.ts";
import { to_form_data } from "../../../modules/svelte-effect-runtime/src/remote/client/form-data.ts";
import { InvalidPrerenderFactoryError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { Live, make_remote_live_stream } from "../../../modules/svelte-effect-runtime/src/live.ts";
import { remote_live_stream } from "../../../modules/svelte-effect-runtime/src/internal/live.ts";
import { error as svelte_error, isRedirect, redirect as svelte_redirect } from "@sveltejs/kit";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { ToEffect } from "../../../modules/svelte-effect-runtime/src/yieldable.ts";
import { Cause, Effect, Exit, Fiber, Schema, Stream, pipe } from "effect";
import { assert_equals, assert_throws } from "../unit/helpers/assert.ts";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, test } from "vitest";
import { stringify } from "devalue";

afterAll(() => {
	reset_server_runtime();
});

test("remote query adapter preserves decoded domain failures", async () => {
	const domain_error = { _tag: "DomainError", message: "nope" };
	const native = {
		load: () =>
			Promise.resolve(
				new Response(
					JSON.stringify(
						create_serialized_remote_failure_envelope(stringify(domain_error)),
					),
					{ status: 500 },
				),
			),
	};

	const query = create_remote_query_adapter(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals(error, domain_error);
});

test("remote failure decoder unwraps SvelteKit message envelopes", () => {
	const domain_error = { _tag: "DomainError", message: "nope" };
	const envelope = create_serialized_remote_failure_envelope(stringify(domain_error));
	const error = normalize_native_error({
		body: { message: JSON.stringify(envelope) },
		status: 500,
	});

	assert_equals(error, domain_error);
});

test("remote failure decoder keeps envelopes with plain messages", () => {
	const domain_error = { _tag: "DomainError", message: "nope" };
	const envelope = {
		...create_serialized_remote_failure_envelope(stringify(domain_error)),
		message: "Unknown Error",
	};
	const error = normalize_native_error({
		body: envelope,
		status: 500,
	});

	assert_equals(error, domain_error);
});

test("native SvelteKit validation errors stay HTTP errors", () => {
	const body = {
		message: "Bad Request",
		issues: [{ message: "missing", path: ["title"] }],
	};
	const error = normalize_native_error({
		body,
		status: 400,
	});

	assert_equals((error as { _tag?: string })._tag, "RemoteHttpError");
	assert_equals((error as { status?: number }).status, 400);
	assert_equals((error as { body?: unknown }).body, body);
});

test("remote query adapter wraps network failures as transport errors", async () => {
	const native = {
		load: () => Promise.reject(new Error("network")),
	};

	const query = create_remote_query_adapter(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
});

test("remote query adapter captures synchronous invocation failures", async () => {
	const query = create_remote_query_adapter<undefined, string>(
		() => {
			throw new Error("serialization failed");
		},
		(value) => value,
		"",
	);
	const QueryProgram = query(undefined);
	const exit = await get_server_dispatcher().run(Effect.exit(QueryProgram));
	const refresh_exit = await get_server_dispatcher().run(Effect.exit(QueryProgram.refresh()));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
	const refresh_error = Exit.isFailure(refresh_exit)
		? Cause.squash(refresh_exit.cause)
		: undefined;
	const set_error = assert_throws(() => QueryProgram.set("recovered"));
	const override_error = assert_throws(() => QueryProgram.withOverride((current) => current));

	assert_equals(Effect.isEffect(QueryProgram), true);
	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals((refresh_error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals((set_error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals((override_error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals((QueryProgram.error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals(QueryProgram.loading, false);
	assert_equals(QueryProgram.ready, false);
});

test("remote query adapter exposes synchronous SvelteKit HTTP failures", async () => {
	const query = create_remote_query_adapter<undefined, never>(
		() => svelte_error(401, "sign in required"),
		(value) => value,
		"",
	);
	const QueryProgram = query(undefined);
	const result = await get_server_dispatcher().run(
		QueryProgram.pipe(
			Effect.catchTag("RemoteHttpError", (error) => Effect.succeed(error.status)),
		),
	);

	assert_equals(result, 401);
	assert_equals((QueryProgram.error as { _tag?: string })._tag, "RemoteHttpError");
});

test("remote query adapter defers synchronous redirects as control flow", async () => {
	const query = create_remote_query_adapter<undefined, never>(
		() => svelte_redirect(303, "/oauth"),
		(value) => value,
		"",
	);
	const QueryProgram = query(undefined);
	const exit = await get_server_dispatcher().run(Effect.exit(QueryProgram));
	const defect = Exit.isFailure(exit)
		? exit.cause.reasons.find(Cause.isDieReason)?.defect
		: undefined;

	assert_equals(isRedirect(defect), true);
	assert_equals((defect as { status?: number }).status, 303);
	assert_equals((defect as { location?: string }).location, "/oauth");
});

test("remote query load stays lazy until its Effect runs", async () => {
	let load_calls = 0;

	const native = {
		load: () => {
			load_calls += 1;

			return Promise.resolve("loaded");
		},
	};
	const query = create_remote_query_adapter(native, (value) => value, "");
	const QueryProgram = query(undefined);

	assert_equals(load_calls, 0);
	assert_equals(await get_server_dispatcher().run(QueryProgram), "loaded");
	assert_equals(load_calls, 1);
});

test("remote response decoding preserves tag-only FormError failures", async () => {
	const form_error = { _tag: "FormError" };
	const native = {
		load: () => Promise.resolve(new Response(JSON.stringify(form_error), { status: 400 })),
	};
	const query = create_remote_query_adapter(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals(error, form_error);
});

test("remote query adapter prefers callable query over hydratable load", async () => {
	let called_query = false;
	let called_load = false;

	const native = Object.assign(
		(_input: undefined) => {
			called_query = true;

			return Promise.resolve({ source: "query" });
		},
		{
			load: () => {
				called_load = true;

				throw new Error("missing hydratable");
			},
		},
	);

	const query = create_remote_query_adapter<undefined, { source: string }>(
		native,
		(value) => value,
		"",
	);

	const result = await get_server_dispatcher().run(query(undefined));

	assert_equals(result, { source: "query" });
	assert_equals(called_query, true);
	assert_equals(called_load, false);
});

test("remote query adapter awaits modern thenable resources before legacy run handles", async () => {
	let run_called = false;

	const native = () => {
		const resource = Promise.resolve("ready") as Promise<string> & {
			run: () => never;
		};

		Object.defineProperty(resource, "run", {
			value: () => {
				run_called = true;

				throw new Error("run removed");
			},
		});

		return resource;
	};

	const query = create_remote_query_adapter<undefined, string>(native, (value) => value, "");

	const result = await get_server_dispatcher().run(query(undefined));

	assert_equals(result, "ready");
	assert_equals(run_called, false);
});

test("remote query adapter awaits callable thenable resources", async () => {
	const then_name = ["th", "en"].join("");
	let decoded_value: unknown;
	let then_called = false;
	let run_called = false;

	const native = () =>
		Object.assign(() => undefined, {
			[then_name]: (resolve: (value: string) => unknown) => {
				then_called = true;

				return resolve("ready");
			},
			run: () => {
				run_called = true;

				throw new Error("run removed");
			},
		});

	const query = create_remote_query_adapter<undefined, string>(
		native,
		(value) => {
			decoded_value = value;

			return value === "ready" ? value : "unresolved";
		},
		"",
	);
	const result = await get_server_dispatcher().run(query(undefined));

	assert_equals(result, "ready");
	assert_equals(decoded_value, "ready");
	assert_equals(then_called, true);
	assert_equals(run_called, false);
});

test("remote batch query adapter opens the native batch window before Effects run", async () => {
	const started: string[] = [];
	const then_name = ["th", "en"].join("");
	const native = (input: string) => ({
		[then_name]: (resolve: (value: string) => unknown) => {
			started.push(input);

			return resolve(input);
		},
	});
	const query = create_remote_query_adapter<string, string>(
		native,
		(value) => value,
		"",
		"batch",
	);
	const First = query("first");
	const Second = query("second");

	await Promise.resolve();

	assert_equals(started, ["first", "second"]);
	assert_equals(await get_server_dispatcher().run(First), "first");
	assert_equals(await get_server_dispatcher().run(Second), "second");
});

test("remote query adapter maps SvelteKit app errors to HTTP errors", async () => {
	const body = {
		message: "Bad Request",
		issues: [{ message: "missing", path: ["title"] }],
	};
	const native = {
		load: () => Promise.resolve(new Response(JSON.stringify(body), { status: 400 })),
	};

	const query = create_remote_query_adapter(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteHttpError");
	assert_equals((error as { status?: number }).status, 400);
	assert_equals((error as { body?: unknown }).body, body);
});

test("remote query adapter maps plain http failures to http errors", async () => {
	const native = {
		load: () =>
			Promise.resolve(
				new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
			),
	};

	const query = create_remote_query_adapter(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteHttpError");
	assert_equals((error as { status?: number }).status, 404);
});

test("remote query adapter exposes http failures on the Effect error channel", async () => {
	const native = {
		load: () =>
			Promise.resolve(
				new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
			),
	};

	const query = create_remote_query_adapter(native, (value) => value, "");
	const result = await get_server_dispatcher().run(
		query(undefined).pipe(
			Effect.catchTag("RemoteHttpError", (error) => Effect.succeed(error.status)),
		),
	);

	assert_equals(result, 404);
});

test("remote query adapter preserves SvelteKit redirects as control flow", async () => {
	const native = () => Promise.resolve().then(() => svelte_redirect(303, "/oauth"));

	const query = create_remote_query_adapter<undefined, never>(native, (value) => value, "");

	const exit = await get_server_dispatcher().run(Effect.exit(query(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals(isRedirect(error), true);
	assert_equals((error as { status?: number }).status, 303);
	assert_equals((error as { location?: string }).location, "/oauth");
});

test("remote query adapter preserves resource state and methods", async () => {
	let refresh_called = false;
	let override_called = false;
	let set_value = 0;

	const native = () => {
		const resource = Promise.resolve(1) as Promise<number> & {
			current: number;
			error: unknown;
			loading: boolean;
			ready: boolean;
			refresh: () => Promise<void>;
			set: (value: number) => void;
			withOverride: (update: (current: number) => number) => () => void;
		};

		Object.defineProperties(resource, {
			current: { get: () => 1 },
			error: { get: () => undefined },
			loading: { get: () => false },
			ready: { get: () => true },
			refresh: {
				value: () => {
					refresh_called = true;

					return Promise.resolve();
				},
			},
			set: {
				value: (value: number) => {
					set_value = value;
				},
			},
			withOverride: {
				value: (update: (current: number) => number) => {
					override_called = update(1) === 2;

					return () => {};
				},
			},
		});

		return resource;
	};

	const query = create_remote_query_adapter<undefined, number>(
		native,
		(value) => value,
		"",
	)(undefined);

	assert_equals(query.current, 1);
	assert_equals(query.loading, false);
	assert_equals(query.ready, true);
	assert_equals(Effect.isEffect(query.refresh()), true);

	query.set(7);
	query.withOverride((current) => current + 1);

	await get_server_dispatcher().run(query.refresh());
	const result = await get_server_dispatcher().run(query);

	assert_equals(result, 1);
	assert_equals(refresh_called, true);
	assert_equals(set_value, 7);
	assert_equals(override_called, true);
});

test("remote prerender adapter captures synchronous invocation failures", async () => {
	const prerender = create_remote_prerender_adapter<undefined, never>(
		() => {
			throw new Error("serialization failed");
		},
		(value) => value,
	);
	const PrerenderProgram = prerender(undefined);

	const exit = await get_server_dispatcher().run(Effect.exit(PrerenderProgram));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
});

test("remote prerender adapter reports invalid native factories", () => {
	assert_throws(
		() => create_remote_prerender_adapter({}, (value) => value),
		InvalidPrerenderFactoryError,
	);
});

test("remote prerender adapter exposes only immutable resource state", async () => {
	const native = () => {
		const resource = Promise.resolve("ready") as Promise<string> & {
			readonly current: string;
			readonly error: unknown;
			readonly loading: boolean;
			readonly ready: boolean;
			readonly refresh: () => Promise<void>;
			readonly set: (value: string) => void;
			readonly withOverride: (update: (current: string) => string) => () => void;
		};

		Object.defineProperties(resource, {
			current: { get: () => "ready" },
			error: { get: () => undefined },
			loading: { get: () => false },
			ready: { get: () => true },
			refresh: { value: () => Promise.resolve() },
			set: { value: () => undefined },
			withOverride: { value: () => () => undefined },
		});

		return resource;
	};
	const prerender = create_remote_prerender_adapter<undefined, string>(native, (value) => value);
	const PrerenderProgram = prerender(undefined);

	assert_equals(await get_server_dispatcher().run(PrerenderProgram), "ready");
	assert_equals(PrerenderProgram.current, "ready");
	assert_equals(PrerenderProgram.error, undefined);
	assert_equals(PrerenderProgram.loading, false);
	assert_equals(PrerenderProgram.ready, true);
	assert_equals("refresh" in PrerenderProgram, false);
	assert_equals("set" in PrerenderProgram, false);
	assert_equals("withOverride" in PrerenderProgram, false);
});

test("remote live query adapter captures synchronous invocation failures", async () => {
	const query = create_remote_live_query_adapter<undefined, never>(
		() => {
			throw new Error("serialization failed");
		},
		(value) => value,
		"",
	);
	const live = query(undefined);
	const exit = await get_server_dispatcher().run(Effect.exit(Stream.runCollect(live)));
	const status = await get_server_dispatcher().run(
		Stream.runCollect(live.pipe(Live.status, Stream.take(1))),
	);
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Stream.isStream(live), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals(status[0]?._tag, "Failed");

	if (status[0]?._tag === "Failed") {
		assert_equals((status[0].cause as { _tag?: string })._tag, "RemoteTransportError");
	}
});

test("remote live query adapter returns a stream with separate controls", async () => {
	let reconnect_called = false;

	const native = () => {
		const resource = {
			connected: true,
			done: false,
			error: undefined,
			reconnect: () => {
				reconnect_called = true;

				return Promise.resolve();
			},
			[Symbol.asyncIterator]: async function* () {
				yield "first";
				yield "second";
			},
		};

		return resource;
	};

	const query = create_remote_live_query_adapter<undefined, string>(
		native,
		(value) => value,
		"",
	)(undefined);
	const derived_query = query.pipe(Stream.map((value) => value.toUpperCase()));
	const status = await get_server_dispatcher().run(
		Stream.runCollect(derived_query.pipe(Live.status, Stream.take(1))),
	);
	const values = await get_server_dispatcher().run(Stream.runCollect(derived_query));

	assert_equals(Stream.isStream(query), true);
	assert_equals(status, [{ _tag: "Open" }]);
	assert_equals(values, ["FIRST", "SECOND"]);
	assert_equals("current" in query, false);
	assert_equals("ready" in query, false);
	assert_equals("reconnect" in query, false);
	assert_equals(reconnect_called, false);

	await get_server_dispatcher().run(derived_query.pipe(Live.reconnect));

	assert_equals(reconnect_called, true);
});

test("remote live control streams stay unbranded after earlier pipe stages", async () => {
	const native = () => ({
		connected: true,
		[Symbol.asyncIterator]: async function* () {
			yield "first";
		},
	});
	const query = create_remote_live_query_adapter<undefined, string>(
		native,
		(value) => value,
		"",
	)(undefined);
	const status = query.pipe(
		Stream.map((value) => value.toUpperCase()),
		Live.status,
	);
	const values = await get_server_dispatcher().run(
		Stream.runCollect(status.pipe(Stream.take(1))),
	);

	assert_equals(values, [{ _tag: "Idle" }]);
	assert_equals(remote_live_stream in status, false);
});

test("remote live query yields cached initial values before subscribing to updates", async () => {
	let iterator_subscriptions = 0;
	let pipe_calls = 0;
	let composition_iterator_subscriptions = 0;

	const resource = Object.assign(Promise.resolve({ value: "first" }), {
		connected: true,
		done: false,
		error: undefined,
		[Symbol.asyncIterator]: async function* () {
			iterator_subscriptions += 1;

			yield { value: "first" };
			yield { value: "second" };
		},
	});
	const native = () => resource;
	const query = create_remote_live_query_adapter<undefined, { readonly value: string }>(
		native,
		(value) => value,
		"",
	);
	const left_query = query(undefined);
	const right_query = query(undefined).pipe(Stream.map((value) => value.value.toUpperCase()));
	const stateful_query = query(undefined).pipe((stream) => {
		const call = ++pipe_calls;

		return stream.pipe(Stream.map((value) => ({ call, value })));
	});
	const InitialValues = Effect.all([
		ToEffect(left_query),
		ToEffect(right_query),
		ToEffect(stateful_query),
	]);

	const initial_values = await get_server_dispatcher().run(InitialValues);

	assert_equals(initial_values, [
		{ value: "first" },
		"FIRST",
		{ call: 1, value: { value: "first" } },
	]);
	assert_equals(iterator_subscriptions, 0);
	assert_equals(pipe_calls, 1);

	const composition_resource = Object.assign(Promise.resolve("cached"), {
		[Symbol.asyncIterator]: async function* () {
			composition_iterator_subscriptions += 1;

			yield "iterator";
		},
	});
	const composition_query = make_remote_live_stream<string>(composition_resource, (error) => {
		throw error;
	});
	const data_first_query = Stream.map(composition_query, (value) => `data:${value}`);
	const standalone_query = pipe(
		composition_query,
		Stream.map((value) => `standalone:${value}`),
	);
	const CompositionValues = Effect.all([ToEffect(data_first_query), ToEffect(standalone_query)]);
	const composition_values = await get_server_dispatcher().run(CompositionValues);

	assert_equals(composition_values, ["data:cached", "standalone:cached"]);
	assert_equals(composition_iterator_subscriptions, 0);

	const updates = await get_server_dispatcher().run(Stream.runCollect(left_query));

	assert_equals(updates, [{ value: "first" }, { value: "second" }]);
	assert_equals(iterator_subscriptions, 1);

	const next_value = await get_server_dispatcher().run(ToEffect(left_query.pipe(Stream.drop(1))));

	assert_equals(next_value, { value: "second" });
	assert_equals(iterator_subscriptions, 2);

	const changed_resource = Object.assign(Promise.resolve({ value: "first" }), {
		[Symbol.asyncIterator]: async function* () {
			yield { value: "changed" };
			yield { value: "second" };
		},
	});
	const changed_query = create_remote_live_query_adapter<undefined, { readonly value: string }>(
		() => changed_resource,
		(value) => value,
		"",
	)(undefined);
	const changed_value = await get_server_dispatcher().run(
		ToEffect(changed_query.pipe(Stream.drop(1))),
	);

	assert_equals(changed_value, { value: "changed" });
});

test("remote live query compares replay snapshots with SvelteKit transport encoders", async () => {
	class Money {
		readonly #amount: number;

		constructor(amount: number) {
			this.#amount = amount;
		}

		get amount(): number {
			return this.#amount;
		}
	}

	const resource = Object.assign(Promise.resolve(new Money(1)), {
		[Symbol.asyncIterator]: async function* () {
			yield new Money(1);
			yield new Money(2);
		},
	});
	const encode_snapshot = make_remote_live_snapshot_encoder({
		Money: {
			encode: (candidate) => (candidate instanceof Money ? candidate.amount : false),
		},
	});
	const query = make_remote_live_stream<Money>(
		resource,
		(error) => {
			throw error;
		},
		encode_snapshot,
	);
	const next_value = await get_server_dispatcher().run(ToEffect(query.pipe(Stream.drop(1))));

	assert_equals(next_value.amount, 2);
});

test("remote live status reports failed resources before closed resources", async () => {
	const native = () => ({
		connected: false,
		done: true,
		error: new Error("connection lost"),
		[Symbol.asyncIterator]: async function* () {},
	});
	const query = create_remote_live_query_adapter<undefined, string>(
		native,
		(value) => value,
		"",
	)(undefined);
	const status = await get_server_dispatcher().run(
		Stream.runCollect(query.pipe(Live.status, Stream.take(1))),
	);

	assert_equals(status[0]?._tag, "Failed");
});

test("remote live status reads transport state when the stream runs", async () => {
	let status_reads = 0;

	const native = () => ({
		get connected() {
			status_reads += 1;

			return true;
		},
		[Symbol.asyncIterator]: async function* () {},
	});
	const query = create_remote_live_query_adapter<undefined, string>(
		native,
		(value) => value,
		"",
	)(undefined);
	const StatusProgram = Stream.runCollect(query.pipe(Live.status, Stream.take(1)));

	assert_equals(status_reads, 0);

	const status = await get_server_dispatcher().run(StatusProgram);

	assert_equals(status, [{ _tag: "Open" }]);
	assert_equals(status_reads, 1);
});

test("remote live reconnect reports missing native support as a transport failure", async () => {
	const native = () => ({
		[Symbol.asyncIterator]: async function* () {},
	});
	const query = create_remote_live_query_adapter<undefined, string>(
		native,
		(value) => value,
		"",
	)(undefined);

	const exit = await get_server_dispatcher().run(Effect.exit(query.pipe(Live.reconnect)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
});

test("remote command adapter resolves callable responses and tracks pending", async () => {
	let release: (() => void) | undefined;
	let signal_invoke_started = () => {};
	let pending_while_running = 0;

	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const invoke_started = new Promise<void>((resolve) => {
		signal_invoke_started = resolve;
	});

	const native = async (input: { title: string }) => {
		pending_while_running = command.pending;
		signal_invoke_started();

		await gate;

		return new Response(JSON.stringify({ ok: input.title }));
	};

	const command = create_remote_command_adapter(native, (value) => value);
	const CommandProgram = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(command({ title: "publish" }));

		yield* Effect.promise(() => invoke_started);

		const pending = command.pending;
		const native_pending = pending_while_running;

		yield* Effect.sync(() => release?.());

		const result = yield* Fiber.join(fiber);

		return { native_pending, pending, result };
	});
	const { native_pending, pending, result } = await get_server_dispatcher().run(CommandProgram);

	assert_equals(pending, 1);
	assert_equals(native_pending, 1);
	assert_equals(result, { ok: "publish" });
	assert_equals(command.pending, 0);
});

test("remote command invocation and pending accounting stay lazy", async () => {
	let invoke_calls = 0;

	const native = () => {
		invoke_calls += 1;

		return Promise.resolve("done");
	};
	const command = create_remote_command_adapter<void, string>(native, (value) => value);
	const CommandProgram = command(undefined);

	assert_equals(invoke_calls, 0);
	assert_equals(command.pending, 0);
	assert_equals(await get_server_dispatcher().run(CommandProgram), "done");
	assert_equals(invoke_calls, 1);
	assert_equals(command.pending, 0);
});

test("remote command adapter preserves the native pending getter", async () => {
	let native_pending = 0;
	let release = () => {};
	let signal_invoke_started = () => {};

	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const invoke_started = new Promise<void>((resolve) => {
		signal_invoke_started = resolve;
	});
	const native = () => {
		native_pending += 1;
		signal_invoke_started();

		return gate.finally(() => {
			native_pending -= 1;
		});
	};

	Object.defineProperty(native, "pending", {
		get: () => native_pending,
	});

	const command = create_remote_command_adapter<void, void>(native, (value) => value);
	const CommandProgram = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(command(undefined));

		yield* Effect.promise(() => invoke_started);

		const pending = command.pending;

		yield* Effect.sync(release);
		yield* Fiber.join(fiber);

		return pending;
	});
	const pending = await get_server_dispatcher().run(CommandProgram);

	assert_equals(pending, 1);
	assert_equals(command.pending, 0);
});

test("remote command updates are applied immediately and stay scoped to one invocation", async () => {
	const events: string[] = [];
	const update_targets: unknown[][] = [];
	const native_posts = Promise.resolve(["one"]);
	const native_posts_query = () => native_posts;
	const native_feed = Object.assign(Promise.resolve("one"), {
		async *[Symbol.asyncIterator]() {
			yield "one";
		},
	});
	const native_feed_query = () => native_feed;
	const posts_query = create_remote_query_adapter<void, string[]>(
		native_posts_query,
		(value) => value,
	);
	const feed_query = create_remote_live_query_adapter<void, string>(
		native_feed_query,
		(value) => value,
	);
	const posts = posts_query(undefined);
	const feed = feed_query(undefined);
	const mapped_feed = feed.pipe(Stream.map((value) => value));
	const override = () => {};
	const native = (input: string) => {
		events.push(`invoke:${input}`);

		const result = Promise.resolve(input).then((value) => {
			events.push(`settled:${input}`);

			return value;
		}) as Promise<string> & {
			updates: (...updates: unknown[]) => Promise<string>;
		};

		result.updates = (...updates: unknown[]) => {
			events.push(`updates:${input}`);
			update_targets.push(updates);

			return result;
		};

		return result;
	};
	const command = create_remote_command_adapter<string, string>(native, (value) => value);
	const UpdatedCommand = command("first").updates(
		posts_query,
		posts,
		feed_query,
		feed,
		mapped_feed,
		override,
	);
	const PlainCommand = command("second");

	assert_equals(events, []);
	assert_equals(await get_server_dispatcher().run(UpdatedCommand), "first");
	assert_equals(await get_server_dispatcher().run(PlainCommand), "second");
	assert_equals(events, [
		"invoke:first",
		"updates:first",
		"settled:first",
		"invoke:second",
		"settled:second",
	]);
	assert_equals(update_targets, [
		[native_posts_query, native_posts, native_feed_query, native_feed, native_feed, override],
	]);
});

test("remote command transport failures preserve the native diagnostic as their cause", async () => {
	const native_error = new Error(
		"Redirects are not allowed in commands. Return a result instead and use goto on the client",
	);
	const native = () => Promise.reject(native_error);
	const command = create_remote_command_adapter<void, never>(native, (value) => value);

	const exit = await get_server_dispatcher().run(Effect.exit(command(undefined)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
	assert_equals((error as { cause?: unknown }).cause, native_error);
	assert_equals(((error as { cause?: Error }).cause as Error).message, native_error.message);
});

test("remote command interruption releases its pending acquisition", async () => {
	let signal_invoke_started = () => {};

	const invoke_started = new Promise<void>((resolve) => {
		signal_invoke_started = resolve;
	});
	const native = () => {
		signal_invoke_started();

		return new Promise<never>(() => {});
	};
	const command = create_remote_command_adapter<void, never>(native, (value) => value);
	const CommandProgram = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(command(undefined));

		yield* Effect.promise(() => invoke_started);

		const pending = command.pending;

		yield* Fiber.interrupt(fiber);

		return pending;
	});
	const pending = await get_server_dispatcher().run(CommandProgram);

	assert_equals(pending, 1);
	assert_equals(command.pending, 0);
});

test("remote command adapter decodes empty successful responses", async () => {
	const native = () => Promise.resolve(new Response(null, { status: 204 }));
	const command = create_remote_command_adapter<void, void>(native, (value) => value);

	const result = await get_server_dispatcher().run(command(undefined));

	assert_equals(result, undefined);
});

test("remote command adapter supports invoke objects and rejects invalid factories", async () => {
	const native = {
		invoke(input: { id: number }) {
			return Promise.resolve({ id: input.id, source: "invoke" });
		},
	};

	const command = create_remote_command_adapter<{ id: number }, { id: number; source: string }>(
		native,
		(value) => value,
	);

	const result = await get_server_dispatcher().run(command({ id: 7 }));

	assert_equals(result, { id: 7, source: "invoke" });
	assert_throws(
		() => {
			create_remote_command_adapter({}, (value) => value);
		},
		Error,
		"Invalid command factory",
	);
});

test("current SvelteKit decodes SER multipart form data", async () => {
	const avatar = new File(["avatar"], "avatar.txt", { type: "text/plain" });
	const form_data = to_form_data({
		active: true,
		avatar,
		count: 2,
		draft: false,
		nested: {
			missing: undefined,
			nil: null,
		},
		rows: [
			{ count: 1, title: "First" },
			{ count: 2, title: "Second" },
		],
		tags: ["svelte", "effect"],
		title: "Hello",
	}, "abc/create");
	const request = new Request("https://example.test/_app/remote/abc/create", {
		method: "POST",
		body: form_data,
	});
	const decoded = await deserialize_with_current_sveltekit(request);
	const data = decoded.data as {
		active: boolean;
		avatar: File;
		count: number;
		draft: boolean;
		nested: { nil: string };
		rows: Array<{ count: number; title: string }>;
		tags: string[];
		title: string;
	};

	assert_equals(data.active, true);
	assert_equals(data.count, 2);
	assert_equals(data.draft, false);
	assert_equals(data.nested, { nil: "" });
	assert_equals(data.rows, [
		{ count: 1, title: "First" },
		{ count: 2, title: "Second" },
	]);
	assert_equals(data.tags, ["svelte", "effect"]);
	assert_equals(data.title, "Hello");
	assert_equals(data.avatar.name, "avatar.txt");
	assert_equals(data.avatar.type, "text/plain");
	assert_equals(await data.avatar.text(), "avatar");
	assert_equals(decoded.meta, {});
	assert_equals(decoded.form_data instanceof FormData, true);
});

test("remote form adapter preserves descriptors and wraps validate in an Effect", async () => {
	const attach = Symbol("attach");
	let validate_called = false;

	const native: Record<PropertyKey, unknown> = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
	};

	Object.defineProperty(native, "enhance", {
		value: () => ({ method: "POST", [attach]: "attached" }),
	});

	Object.defineProperty(native, "validate", {
		value: () => {
			validate_called = true;
			return Promise.resolve();
		},
	});

	Object.defineProperty(native, attach, {
		enumerable: false,
		value: "root-attachment",
	});

	const form = create_remote_form_adapter(native, (value) => value, "");

	assert_equals(Reflect.ownKeys(form).includes(attach), true);
	assert_equals(typeof form.enhance, "function");
	assert_equals(form.method, "POST");
	assert_equals(form.action, "?/remote=abc%2Fcreate");

	await get_server_dispatcher().run(form.validate());

	assert_equals(validate_called, true);
});

test("remote form adapter maps all to includeUntouched for stable Kit validate", async () => {
	let received_options: Record<string, unknown> | undefined;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
	};

	Object.defineProperty(native, "validate", {
		value: async function validate({
			includeUntouched = false,
			preflightOnly = false,
		}: {
			includeUntouched?: boolean;
			preflightOnly?: boolean;
		} = {}) {
			received_options = arguments[0] as Record<string, unknown>;

			return { includeUntouched, preflightOnly };
		},
	});

	const form = create_remote_form_adapter(native, (value) => value, "");

	await get_server_dispatcher().run(form.validate({ all: true, preflightOnly: true }));

	assert_equals(received_options?.all, true);
	assert_equals(received_options?.includeUntouched, true);
	assert_equals(received_options?.preflightOnly, true);
});

test("remote form adapter keeps all for next Kit validate", async () => {
	let received_options: Record<string, unknown> | undefined;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
	};

	Object.defineProperty(native, "validate", {
		value: async function validate({
			all = false,
			preflightOnly = false,
			includeUntouched,
		}: {
			all?: boolean;
			preflightOnly?: boolean;
			includeUntouched?: boolean;
		} = {}) {
			received_options = arguments[0] as Record<string, unknown>;

			return { all, includeUntouched, preflightOnly };
		},
	});

	const form = create_remote_form_adapter(native, (value) => value, "");

	await get_server_dispatcher().run(form.validate({ all: true, preflightOnly: true }));

	assert_equals(received_options?.all, true);
	assert_equals("includeUntouched" in (received_options ?? {}), false);
	assert_equals(received_options?.preflightOnly, true);
});

test("remote form adapter posts explicit input when native submit is form-bound", async () => {
	const original_fetch = globalThis.fetch;
	const had_location = "location" in globalThis;
	const original_location = globalThis.location;

	let native_submit_called = false;
	let requested_url = "";
	let request_pathname: string | null = null;
	let request_search: string | null = null;
	let posted_title: string | undefined;
	let posted_draft: boolean | undefined;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		submit() {
			native_submit_called = true;
			throw new Error("Cannot call submit() before the form is attached");
		},
	};

	Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: new URL("https://example.test/profile?tab=settings"),
	});

	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		const request = new Request(new URL(String(url), globalThis.location.href), init);
		const decoded = await deserialize_with_current_sveltekit(request);

		requested_url = String(url);
		request_pathname = headers.get("x-sveltekit-pathname");
		request_search = headers.get("x-sveltekit-search");
		posted_title = decoded.data.title as string;
		posted_draft = decoded.data.draft as boolean;

		return new Response(
			JSON.stringify({
				type: "result",
				data: stringify({
					_: { submission: true, result: { ok: true } },
				}),
			}),
		);
	}) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ draft: boolean; title: string }, { ok: boolean }>(
			native,
			(value) => value,
			"/_app/remote",
		);

		const result = await get_server_dispatcher().run(form({ draft: false, title: "hello" }));

		assert_equals(result, { ok: true });
		assert_equals(native_submit_called, false);
		assert_equals(requested_url, "/_app/remote/abc/create");
		assert_equals(request_pathname, "/profile");
		assert_equals(request_search, "?tab=settings");
		assert_equals(posted_title, "hello");
		assert_equals(posted_draft, false);
	} finally {
		globalThis.fetch = original_fetch;

		if (had_location) {
			Object.defineProperty(globalThis, "location", {
				configurable: true,
				value: original_location,
			});
		} else {
			Reflect.deleteProperty(globalThis, "location");
		}
	}
});

test("remote form adapter uses Kit's binary request bridge", async () => {
	class TransportValue {
		constructor(readonly value: string) {}
	}

	const had_location = "location" in globalThis;
	const original_location = globalThis.location;
	const serialized_inputs: unknown[] = [];
	const serialized_meta: unknown[] = [];
	let refresh_calls = 0;
	let request_calls = 0;
	let request_init: RequestInit | undefined;
	let requested_url = "";

	Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: new URL("https://example.test/profile?tab=settings"),
	});

	try {
		const form = create_remote_form_adapter<
			{ draft: boolean; title: string },
			{ message: TransportValue }
		>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				binary_form_content_type: "application/x-sveltekit-formdata",
				refresh: () => {
					refresh_calls += 1;
				},
				remote_request: (url, init) => {
					request_calls += 1;
					requested_url = url;
					request_init = init;

					return Promise.resolve({
						_: {
							result: {
								message: new TransportValue(`decoded ${request_calls}`),
							},
							submission: true,
						},
						...(request_calls === 1
							? { q: { "abc/query": { v: "fresh" } }, r: true }
							: {}),
					});
				},
				serialize_binary_form: (data, meta) => {
					serialized_inputs.push(data);
					serialized_meta.push(meta);

					return { blob: new Blob(["binary-form"]) };
				},
			},
		);

		const first = await get_server_dispatcher().run(form({ draft: false, title: "first" }));
		const second = await get_server_dispatcher().run(form({ draft: true, title: "second" }));
		const headers = new Headers(request_init?.headers);

		assert_equals(first.message.value, "decoded 1");
		assert_equals(second.message.value, "decoded 2");
		assert_equals(serialized_inputs, [
			{ draft: false, title: "first" },
			{ draft: true, title: "second" },
		]);
		assert_equals(serialized_meta, [{ remote_refreshes: [] }, { remote_refreshes: [] }]);
		assert_equals(requested_url, "/_app/remote/abc/create");
		assert_equals(request_init?.method, "POST");
		assert_equals(request_init?.body instanceof Blob, true);
		assert_equals(request_init?.signal instanceof AbortSignal, true);
		assert_equals(headers.get("content-type"), "application/x-sveltekit-formdata");
		assert_equals(headers.get("x-sveltekit-pathname"), "/profile");
		assert_equals(headers.get("x-sveltekit-search"), "?tab=settings");
		assert_equals(refresh_calls, 1);
	} finally {
		if (had_location) {
			Object.defineProperty(globalThis, "location", {
				configurable: true,
				value: original_location,
			});
		} else {
			Reflect.deleteProperty(globalThis, "location");
		}
	}
});

test("keyed remote forms post the key in Kit's binary payload", async () => {
	let requested_url = "";
	let serialized_input: unknown;

	const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
		{
			method: "POST",
			action: "?/remote=abc%2Fcreate",
			for(key: string | number | boolean) {
				return {
					method: "POST",
					action: `?/remote=${encodeURIComponent(`abc/create/${JSON.stringify(key)}`)}`,
				};
			},
		},
		(value) => value,
		"/_app/remote",
		{
			binary_form_content_type: "application/x-sveltekit-formdata",
			remote_request: (url) => {
				requested_url = url;

				return Promise.resolve({ _: { result: { ok: true } } });
			},
			serialize_binary_form: (data) => {
				serialized_input = data;

				return { blob: new Blob() };
			},
		},
	);

	const result = await get_server_dispatcher().run(form.for("profile")({ title: "saved" }));

	assert_equals(result, { ok: true });
	assert_equals(requested_url, "/_app/remote/abc/create");
	assert_equals(serialized_input, { id: "profile", title: "saved" });
});

test("keyed remote forms preserve Kit's fallback form payload", async () => {
	const original_fetch = globalThis.fetch;
	const posted_inputs: Record<string, unknown>[] = [];
	let requested_url = "";

	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const request = new Request(new URL(String(url), "https://example.test"), init);
		const decoded = await deserialize_with_current_sveltekit(request);

		requested_url = String(url);
		posted_inputs.push(decoded.data);

		return new Response(
			JSON.stringify({
				type: "result",
				data: stringify({ _: { result: { ok: true } } }),
			}),
		);
	}) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ id?: string; title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
				for(key: string | number | boolean) {
					return {
						method: "POST",
						action: `?/remote=${encodeURIComponent(`abc/create/${JSON.stringify(key)}`)}`,
					};
				},
			},
			(value) => value,
			"/_app/remote",
		);

		const keyed_form = form.for("profile");

		await get_server_dispatcher().run(keyed_form({ title: "saved" }));
		await get_server_dispatcher().run(keyed_form({ id: "custom", title: "saved" }));

		assert_equals(requested_url, "/_app/remote/abc/create");
		assert_equals(posted_inputs, [
			{ id: "profile", title: "saved" },
			{ id: "custom", title: "saved" },
		]);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter serializes no-input Kit forms as an object", async () => {
	let serialized_input: unknown;

	const form = create_remote_form_adapter<void, string>(
		{
			method: "POST",
			action: "?/remote=abc%2Fcreate",
		},
		(value) => value,
		"/_app/remote",
		{
			binary_form_content_type: "application/x-sveltekit-formdata",
			remote_request: () =>
				Promise.resolve({
					_: { result: "created", submission: true },
					r: true,
				}),
			serialize_binary_form: (data) => {
				serialized_input = data;

				return { blob: new Blob() };
			},
		},
	);

	const result = await get_server_dispatcher().run(form());

	assert_equals(result, "created");
	assert_equals(serialized_input, {});
});

test("remote form adapter delegates exact redirect invalidation to Kit", async () => {
	const navigated_to: Array<[string, boolean]> = [];
	let request_calls = 0;
	let continued_after_redirect = false;

	const form = create_remote_form_adapter<{ title: string }, string>(
		{
			method: "POST",
			action: "?/remote=abc%2Fcreate",
		},
		(value) => value,
		"/_app/remote",
		{
			binary_form_content_type: "application/x-sveltekit-formdata",
			navigate: (location, invalidate_all) => {
				navigated_to.push([location, invalidate_all]);
			},
			remote_request: () => {
				request_calls += 1;

				return Promise.resolve({
					redirect: request_calls === 1 ? "/posts" : "/archive",
					...(request_calls === 1 ? { r: true } : {}),
				});
			},
			serialize_binary_form: () => ({ blob: new Blob() }),
		},
	);
	const RedirectProgram = Effect.gen(function* () {
		yield* form({ title: "first" });

		continued_after_redirect = true;
	});

	await get_server_dispatcher().run(RedirectProgram);
	await get_server_dispatcher().run(form({ title: "second" }));

	assert_equals(continued_after_redirect, false);
	assert_equals(navigated_to, [
		["/posts", false],
		["/archive", true],
	]);
});

test("interrupting a remote form aborts Kit's lazy remote request", async () => {
	let request_calls = 0;
	let request_signal: AbortSignal | undefined;
	let signal_request_started = () => {};

	const request_started = new Promise<void>((resolve) => {
		signal_request_started = resolve;
	});
	const form = create_remote_form_adapter<{ title: string }, string>(
		{
			method: "POST",
			action: "?/remote=abc%2Fcreate",
		},
		(value) => value,
		"/_app/remote",
		{
			binary_form_content_type: "application/x-sveltekit-formdata",
			remote_request: (_url, init) => {
				request_calls += 1;
				request_signal = init?.signal ?? undefined;
				signal_request_started();

				return new Promise<unknown>((_resolve, reject) => {
					request_signal?.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				});
			},
			serialize_binary_form: () => ({ blob: new Blob() }),
		},
	);
	const FormProgram = form({ title: "draft" });

	assert_equals(request_calls, 0);

	const InterruptProgram = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(FormProgram);

		yield* Effect.promise(() => request_started);

		const calls_before_interrupt = request_calls;
		const aborted_before_interrupt = request_signal?.aborted;

		yield* Fiber.interrupt(fiber);

		return { aborted_before_interrupt, calls_before_interrupt };
	});
	const { aborted_before_interrupt, calls_before_interrupt } =
		await get_server_dispatcher().run(InterruptProgram);

	assert_equals(calls_before_interrupt, 1);
	assert_equals(aborted_before_interrupt, false);
	assert_equals(request_signal?.aborted, true);
});

test("remote form adapter decodes current SvelteKit form result data", async () => {
	const original_fetch = globalThis.fetch;
	let refresh_calls = 0;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					data: stringify({
						_: { submission: true, result: { ok: true } },
					}),
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				refresh: () => {
					refresh_calls += 1;
				},
			},
		);

		const result = await get_server_dispatcher().run(form({ title: "hello" }));

		assert_equals(result, { ok: true });
		assert_equals(refresh_calls, 1);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter reads status from current SvelteKit error data", async () => {
	const original_fetch = globalThis.fetch;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "error",
					error: { message: "Post not found", status: 404 },
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
		);

		const exit = await get_server_dispatcher().run(Effect.exit(form({ title: "missing" })));
		const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

		assert_equals(Exit.isFailure(exit), true);
		assert_equals((error as { _tag?: string })._tag, "RemoteHttpError");
		assert_equals((error as { status?: number }).status, 404);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter prefers SvelteKit 2's top-level error status", async () => {
	const original_fetch = globalThis.fetch;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "error",
					status: 404,
					error: { message: "Post not found", status: 418 },
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
		);

		const exit = await get_server_dispatcher().run(Effect.exit(form({ title: "missing" })));
		const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

		assert_equals(Exit.isFailure(exit), true);
		assert_equals((error as { _tag?: string })._tag, "RemoteHttpError");
		assert_equals((error as { status?: number }).status, 404);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter navigates result and top-level redirect envelopes", async () => {
	const original_fetch = globalThis.fetch;
	const navigated_to: Array<[string, boolean]> = [];
	let refresh_calls = 0;
	let response_index = 0;
	let continued_after_redirect = false;

	const responses = [
		{
			type: "result",
			data: stringify({ redirect: "/posts" }),
		},
		{
			type: "redirect",
			location: "/archive",
		},
	];

	globalThis.fetch = (() =>
		Promise.resolve(new Response(JSON.stringify(responses[response_index++])))) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				navigate: (location, invalidate_all) => {
					navigated_to.push([location, invalidate_all]);
				},
				refresh: () => {
					refresh_calls += 1;
				},
			},
		);

		const RedirectProgram = Effect.gen(function* () {
			yield* form({ title: "hello" });

			continued_after_redirect = true;
		});

		const result_redirect = await get_server_dispatcher().run(RedirectProgram);
		const top_level_redirect = await get_server_dispatcher().run(form({ title: "again" }));

		assert_equals(result_redirect, undefined);
		assert_equals(top_level_redirect, undefined);
		assert_equals(continued_after_redirect, false);
		assert_equals(navigated_to, [
			["/posts", true],
			["/archive", true],
		]);
		assert_equals(refresh_calls, 0);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter falls back to full refresh for SvelteKit side-channel data", async () => {
	const original_fetch = globalThis.fetch;
	let refresh_calls = 0;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					data: stringify({
						_: { submission: true, result: { ok: true } },
						l: { "abc/live": { v: "live" } },
						q: { "abc/query": { v: "query" } },
						r: true,
					}),
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				refresh: () => {
					refresh_calls += 1;
				},
			},
		);

		const result = await get_server_dispatcher().run(form({ title: "hello" }));

		assert_equals(result, { ok: true });
		assert_equals(refresh_calls, 1);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter uses SvelteKit transport decoders", async () => {
	class TransportValue {
		constructor(readonly value: string) {}
	}

	const original_fetch = globalThis.fetch;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					data: stringify(
						{
							_: {
								result: { message: new TransportValue("decoded") },
								submission: true,
							},
						},
						{
							TransportValue: (value) =>
								value instanceof TransportValue ? value.value : undefined,
						},
					),
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { message: TransportValue }>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				decoders: {
					TransportValue: (value) => new TransportValue(String(value)),
				},
			},
		);

		const result = await get_server_dispatcher().run(form({ title: "hello" }));

		assert_equals(result.message.value, "decoded");
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter uses native submit when no remote endpoint is configured", async () => {
	let submitted_title = "";

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		submit(input: { title: string }) {
			submitted_title = input.title;

			return Promise.resolve(`native ${input.title}`);
		},
	};

	const form = create_remote_form_adapter<{ title: string }, string>(
		native,
		(value) => value,
		"",
	);

	const result = await get_server_dispatcher().run(form({ title: "draft" }));

	assert_equals(result, "native draft");
	assert_equals(submitted_title, "draft");
});

test("remote form adapter reports transport errors without submit or endpoint", async () => {
	const form = create_remote_form_adapter<{ title: string }, string>(
		{ method: "POST" },
		(value) => value,
		"",
	);

	const exit = await get_server_dispatcher().run(Effect.exit(form({ title: "draft" })));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
});

test("remote form adapter maps endpoint validation issues to the Effect error channel", async () => {
	const original_fetch = globalThis.fetch;
	let refresh_calls = 0;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					data: stringify({
						_: {
							issues: [{ message: "Title too short", path: ["title"] }],
							submission: true,
						},
					}),
				}),
			),
		)) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, string>(
			{
				method: "POST",
				action: "?/remote=abc%2Fcreate",
			},
			(value) => value,
			"/_app/remote",
			{
				refresh: () => {
					refresh_calls += 1;
				},
			},
		);

		const exit = await get_server_dispatcher().run(Effect.exit(form({ title: "x" })));
		const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

		assert_equals(Exit.isFailure(exit), true);
		assert_equals((error as { _tag?: string })._tag, "RemoteValidationError");
		assert_equals(
			(error as { issues?: Array<{ message: string }> }).issues?.[0]?.message,
			"Title too short",
		);
		assert_equals(refresh_calls, 0);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter returns keyed forms from nested for calls", async () => {
	const keys: Array<string | number | boolean> = [];
	const native = {
		method: "POST",
		action: "?/remote=abc%2Froot",
		for(key: string | number | boolean) {
			keys.push(key);

			return {
				method: "POST",
				action: `?/remote=abc%2F${key}`,
				submit(input: { title: string }) {
					return Promise.resolve(`${key}:${input.title}`);
				},
			};
		},
	};

	const form = create_remote_form_adapter<{ title: string }, string>(
		native,
		(value) => value,
		"",
	);

	const child = form.for("profile");
	const result = await get_server_dispatcher().run(child({ title: "saved" }));

	assert_equals(keys, ["profile"]);
	assert_equals(child.action, "?/remote=abc%2Fprofile");
	assert_equals(result, "profile:saved");
});

test("remote form adapter preflight calls native preflight and keeps callable", async () => {
	const schemas: unknown[] = [];
	const schema = {
		"~standard": {
			validate(value: unknown) {
				return { value };
			},
		},
	};
	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		preflight(next_schema: unknown) {
			schemas.push(next_schema);

			return native;
		},
		submit(input: { title: string }) {
			return Promise.resolve(input.title);
		},
	};

	const form = create_remote_form_adapter<{ title: string }, string>(
		native,
		(value) => value,
		"",
	);

	const preflighted = form.preflight(schema);
	const result = await get_server_dispatcher().run(preflighted({ title: "ok" }));

	assert_equals(preflighted, form);
	assert_equals(schemas, [schema]);
	assert_equals(result, "ok");
});

test("remote form adapter normalizes Effect Schema preflight input", () => {
	const schemas: unknown[] = [];
	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		preflight(next_schema: unknown) {
			schemas.push(next_schema);

			return native;
		},
	};

	const form = create_remote_form_adapter<{ title: string }, string>(
		native,
		(value) => value,
		"",
	);

	form.preflight(Schema.Struct({ title: Schema.String }));

	assert_equals(
		typeof (schemas[0] as { "~standard"?: { validate?: unknown } })["~standard"]?.validate,
		"function",
	);
});

test("remote form adapter runs preflight before direct endpoint submit", async () => {
	const original_fetch = globalThis.fetch;
	let fetch_called = false;

	const schema = {
		"~standard": {
			validate() {
				return {
					issues: [{ message: "missing", path: ["title"] }],
				};
			},
		},
	};
	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		preflight() {
			return native;
		},
	};

	globalThis.fetch = (() => {
		fetch_called = true;

		return Promise.resolve(new Response());
	}) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, string>(
			native,
			(value) => value,
			"/_app/remote",
		);

		form.preflight(schema);

		const exit = await get_server_dispatcher().run(Effect.exit(form({ title: "" })));
		const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

		assert_equals(Exit.isFailure(exit), true);
		assert_equals((error as { _tag?: string })._tag, "RemoteValidationError");
		assert_equals(
			(error as { issues?: Array<{ message: string }> }).issues?.[0]?.message,
			"missing",
		);
		assert_equals(fetch_called, false);
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter preserves SvelteKit 2.61 enhance instance descriptors", () => {
	const fields = { title: { value: () => "draft" } };

	let callback_fields: unknown;
	let callback_pending: unknown;
	let callback_submit_is_effect = false;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		enhance(callback: (event: unknown) => unknown) {
			const event = {};

			Object.defineProperties(event, {
				fields: {
					get: () => fields,
				},
				pending: {
					get: () => 1,
				},
				submit: {
					value: () => Promise.resolve(true),
				},
			});

			callback(event);

			return native;
		},
	};

	const form = create_remote_form_adapter(native, (value) => value, "");

	form.enhance((event: unknown) => {
		const wrapped = event as {
			fields: unknown;
			pending: number;
			submit: () => unknown;
		};

		callback_fields = wrapped.fields;
		callback_pending = wrapped.pending;
		callback_submit_is_effect = Effect.isEffect(wrapped.submit());
	});

	assert_equals(callback_fields, fields);
	assert_equals(callback_pending, 1);
	assert_equals(callback_submit_is_effect, true);
});

test("remote form adapter wraps enhance submit callbacks as Effects", () => {
	let callback_submit_is_effect = false;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		enhance(callback: (event: unknown) => unknown) {
			callback({
				submit: () => Promise.resolve("ok"),
			});

			return { method: "POST" };
		},
	};

	const form = create_remote_form_adapter(native, (value) => value, "");

	form.enhance((event: unknown) => {
		const result = (event as { submit: () => unknown }).submit();
		callback_submit_is_effect = Effect.isEffect(result);
	});

	assert_equals(callback_submit_is_effect, true);
});

test("remote form adapter resolves enhance submit to form result", async () => {
	let submit_effect: unknown;
	let form_result: { id: string } | undefined;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		get result() {
			return form_result;
		},
		enhance(callback: (event: unknown) => unknown) {
			callback({
				get result() {
					return form_result;
				},
				submit: () => {
					form_result = { id: "created" };

					return Promise.resolve(true);
				},
			});

			return { method: "POST" };
		},
	};

	const form = create_remote_form_adapter(native, (value) => value, "");

	form.enhance((event: unknown) => {
		submit_effect = (event as { submit: () => unknown }).submit();
	});

	const result = await get_server_dispatcher().run(
		submit_effect as Effect.Effect<{ id: string } | undefined, unknown, unknown>,
	);

	assert_equals(result, { id: "created" });
});

test("remote form enhance submit suppresses SvelteKit redirects as control flow", async () => {
	let callback_result: unknown;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		enhance(callback: (event: unknown) => unknown) {
			callback_result = callback({
				submit: () => Promise.resolve().then(() => svelte_redirect(303, "/oauth")),
			});

			return { method: "POST" };
		},
	};

	const form = create_remote_form_adapter(native, (value) => value, "");

	form.enhance((event: unknown) =>
		Effect.gen(function* () {
			yield* (
				event as {
					submit: () => Effect.Effect<unknown, unknown, never>;
				}
			).submit();
		}),
	);

	assert_equals(typeof (callback_result as { then?: unknown } | undefined)?.then, "function");

	try {
		const result = (await callback_result) as unknown;

		assert_equals(result, undefined);
	} finally {
		reset_dispatcher();
	}
});

test("remote form adapter preserves enhance submit updates as an Effect", async () => {
	let submit_started = false;
	let updates_called = false;
	let submit_effect: unknown;
	let form_result: { id: string } | undefined;
	const native_posts = Promise.resolve(["one"]);
	const posts = create_remote_query_adapter<void, string[]>(
		() => native_posts,
		(value) => value,
	)(undefined);

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		enhance(callback: (event: unknown) => unknown) {
			callback({
				get result() {
					return form_result;
				},
				submit: () => {
					submit_started = true;

					const promise = Promise.resolve(true) as Promise<boolean> & {
						updates: (...args: unknown[]) => Promise<boolean>;
					};

					promise.updates = (...args: unknown[]) => {
						updates_called = args[0] === native_posts;
						form_result = { id: "updated" };

						return Promise.resolve(true);
					};

					return promise;
				},
			});

			return { method: "POST" };
		},
	};

	const form = create_remote_form_adapter(native, (value) => value, "");

	form.enhance((event: unknown) => {
		submit_effect = (
			event as {
				submit: () => {
					updates: (...args: unknown[]) => unknown;
				};
			}
		)
			.submit()
			.updates(posts);
	});

	assert_equals(Effect.isEffect(submit_effect), true);
	assert_equals(submit_started, false);

	const result = await get_server_dispatcher().run(
		submit_effect as Effect.Effect<{ id: string } | undefined, unknown, unknown>,
	);

	assert_equals(result, { id: "updated" });
	assert_equals(submit_started, true);
	assert_equals(updates_called, true);
});

interface CurrentSvelteKitFormData {
	readonly data: Record<string, unknown>;
	readonly form_data: FormData | null;
	readonly meta: Record<string, unknown>;
}

async function deserialize_with_current_sveltekit(
	request: Request,
	form_id = "abc/create",
): Promise<CurrentSvelteKitFormData> {
	const require = createRequire(import.meta.url);
	const package_path = require.resolve("@sveltejs/kit/package.json");
	const module_url = pathToFileURL(
		join(dirname(package_path), "src", "runtime", "form-utils.js"),
	).href;
	const form_utils = (await import(module_url)) as {
		deserialize_binary_form: (
			request: Request,
			form_id: string,
		) => Promise<CurrentSvelteKitFormData>;
	};

	return form_utils.deserialize_binary_form(request, form_id);
}
