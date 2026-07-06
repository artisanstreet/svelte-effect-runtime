import { test } from "vitest";
import { assert_equals, assert_throws, assert_rejects } from "./helpers/assert.ts";
import { isRedirect, redirect as svelte_redirect } from "@sveltejs/kit";
import { Effect, Schema, Stream } from "effect";
import { stringify } from "devalue";
import {
	create_remote_command_adapter,
	create_remote_form_adapter,
	create_remote_live_query_adapter,
	create_remote_query_adapter,
} from "../../../modules/svelte-effect-runtime/src/remote/client.ts";
import { to_form_data } from "../../../modules/svelte-effect-runtime/src/remote/client/form-data.ts";
import { normalize_native_error } from "../../../modules/svelte-effect-runtime/src/remote/client/failures.ts";
import { create_serialized_remote_failure_envelope } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { Live } from "../../../modules/svelte-effect-runtime/src/live.ts";

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

	const error = await assert_rejects(() => Effect.runPromise(query(undefined)));

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

	const error = await assert_rejects(() => Effect.runPromise(query(undefined)));

	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
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

	const result = await Effect.runPromise(query(undefined));

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

	const result = await Effect.runPromise(query(undefined));

	assert_equals(result, "ready");
	assert_equals(run_called, false);
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

	const error = await assert_rejects(() => Effect.runPromise(query(undefined)));

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

	const error = await assert_rejects(() => Effect.runPromise(query(undefined)));

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
	const result = await Effect.runPromise(
		query(undefined).pipe(
			Effect.catchTag("RemoteHttpError", (error) => Effect.succeed(error.status)),
		),
	);

	assert_equals(result, 404);
});

test("remote query adapter preserves SvelteKit redirects as control flow", async () => {
	const native = () => Promise.resolve().then(() => svelte_redirect(303, "/oauth"));

	const query = create_remote_query_adapter<undefined, never>(native, (value) => value, "");

	const error = await assert_rejects(() => Effect.runPromise(query(undefined)));

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

	await Effect.runPromise(query.refresh());
	const result = await Effect.runPromise(query);

	assert_equals(result, 1);
	assert_equals(refresh_called, true);
	assert_equals(set_value, 7);
	assert_equals(override_called, true);
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
	const status = await Effect.runPromise(
		Stream.runCollect(Live.status(derived_query).pipe(Stream.take(1))),
	);
	const values = await Effect.runPromise(Stream.runCollect(derived_query));

	assert_equals(Stream.isStream(query), true);
	assert_equals(status, [{ _tag: "Open" }]);
	assert_equals(values, ["FIRST", "SECOND"]);
	assert_equals("current" in query, false);
	assert_equals("ready" in query, false);
	assert_equals("reconnect" in query, false);

	await Effect.runPromise(Live.reconnect(derived_query));

	assert_equals(reconnect_called, true);
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
	const status = await Effect.runPromise(
		Stream.runCollect(Live.status(query).pipe(Stream.take(1))),
	);

	assert_equals(status[0]?._tag, "Failed");
});

test("remote command adapter resolves callable responses and tracks pending", async () => {
	let release: (() => void) | undefined;
	let pending_while_running = 0;

	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});

	const native = async (input: { title: string }) => {
		pending_while_running = command.pending;

		await gate;

		return new Response(JSON.stringify({ ok: input.title }));
	};

	const command = create_remote_command_adapter(native, (value) => value);

	const promise = Effect.runPromise(command({ title: "publish" }));

	await new Promise((resolve) => setTimeout(resolve, 0));

	assert_equals(command.pending, 1);
	assert_equals(pending_while_running, 1);

	release?.();

	const result = await promise;

	assert_equals(result, { ok: "publish" });
	assert_equals(command.pending, 0);
});

test("remote command adapter decodes empty successful responses", async () => {
	const native = () => Promise.resolve(new Response(null, { status: 204 }));
	const command = create_remote_command_adapter<void, void>(native, (value) => value);

	const result = await Effect.runPromise(command(undefined));

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

	const result = await Effect.runPromise(command({ id: 7 }));

	assert_equals(result, { id: 7, source: "invoke" });
	assert_throws(
		() => {
			create_remote_command_adapter({}, (value) => value);
		},
		Error,
		"Invalid command factory",
	);
});

test("remote form data encodes nested scalar, array, blob, and empty values", () => {
	const blob = new Blob(["avatar"]);
	const form_data = to_form_data({
		active: true,
		avatar: blob,
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
	});

	assert_equals(form_data.get("title"), "Hello");
	assert_equals(form_data.get("n:count"), "2");
	assert_equals(form_data.get("b:active"), "on");
	assert_equals(form_data.has("b:draft"), false);
	assert_equals(form_data.get("tags[0]"), "svelte");
	assert_equals(form_data.get("tags[1]"), "effect");
	assert_equals(form_data.get("rows[0].title"), "First");
	assert_equals(form_data.get("n:rows[1].count"), "2");
	assert_equals(form_data.get("nested.nil"), "");
	assert_equals(form_data.has("nested.missing"), false);
	assert_equals(form_data.get("avatar") instanceof Blob, true);
});

test("remote form data indexes arrays of objects", () => {
	const form_data = to_form_data({
		variants: [
			{ content_type: "image/avif", suffix: 400 },
			{ content_type: "image/webp", suffix: 800 },
		],
	});

	assert_equals(form_data.get("variants[0].content_type"), "image/avif");
	assert_equals(form_data.get("n:variants[0].suffix"), "400");
	assert_equals(form_data.get("variants[1].content_type"), "image/webp");
	assert_equals(form_data.get("n:variants[1].suffix"), "800");
	assert_equals(form_data.has("n:variants[].suffix"), false);
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

	await Effect.runPromise(form.validate());

	assert_equals(validate_called, true);
});

test("remote form adapter posts explicit input when native submit is form-bound", async () => {
	const original_fetch = globalThis.fetch;

	let native_submit_called = false;
	let requested_url = "";
	let posted_title: FormDataEntryValue | null = null;

	const native = {
		method: "POST",
		action: "?/remote=abc%2Fcreate",
		submit() {
			native_submit_called = true;
			throw new Error("Cannot call submit() before the form is attached");
		},
	};

	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const body = init?.body as FormData;

		requested_url = String(url);
		posted_title = body.get("title");

		return Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					result: stringify({ result: { ok: true } }),
				}),
			),
		);
	}) as typeof fetch;

	try {
		const form = create_remote_form_adapter<{ title: string }, { ok: boolean }>(
			native,
			(value) => value,
			"/_app/remote",
		);

		const result = await Effect.runPromise(form({ title: "hello" }));

		assert_equals(result, { ok: true });
		assert_equals(native_submit_called, false);
		assert_equals(requested_url, "/_app/remote/abc/create");
		assert_equals(posted_title, "hello");
	} finally {
		globalThis.fetch = original_fetch;
	}
});

test("remote form adapter decodes SvelteKit data result envelopes", async () => {
	const original_fetch = globalThis.fetch;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					data: stringify({ result: { ok: true } }),
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

		const result = await Effect.runPromise(form({ title: "hello" }));

		assert_equals(result, { ok: true });
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

	const result = await Effect.runPromise(form({ title: "draft" }));

	assert_equals(result, "native draft");
	assert_equals(submitted_title, "draft");
});

test("remote form adapter reports transport errors without submit or endpoint", async () => {
	const form = create_remote_form_adapter<{ title: string }, string>(
		{ method: "POST" },
		(value) => value,
		"",
	);

	const error = await assert_rejects(() => Effect.runPromise(form({ title: "draft" })));

	assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
});

test("remote form adapter maps endpoint validation issues to the Effect error channel", async () => {
	const original_fetch = globalThis.fetch;

	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					type: "result",
					result: stringify({
						issues: [{ message: "Title too short", path: ["title"] }],
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
		);

		const error = await assert_rejects(() => Effect.runPromise(form({ title: "x" })));

		assert_equals((error as { _tag?: string })._tag, "RemoteValidationError");
		assert_equals(
			(error as { issues?: Array<{ message: string }> }).issues?.[0]?.message,
			"Title too short",
		);
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
	const result = await Effect.runPromise(child({ title: "saved" }));

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
	const result = await Effect.runPromise(preflighted({ title: "ok" }));

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

	const result = await Effect.runPromise(
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
						updates_called = args[0] === "refresh";
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
			.updates("refresh");
	});

	assert_equals(Effect.isEffect(submit_effect), true);
	assert_equals(submit_started, false);

	const result = await Effect.runPromise(
		submit_effect as Effect.Effect<{ id: string } | undefined, unknown, unknown>,
	);

	assert_equals(result, { id: "updated" });
	assert_equals(submit_started, true);
	assert_equals(updates_called, true);
});
