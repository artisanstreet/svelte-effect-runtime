import {
	Query as ServerQuery,
	Requested,
} from "../../../modules/svelte-effect-runtime/src/server/index.ts";
import {
	reset_test_query,
	reset_test_requested,
	set_test_query,
	set_test_requested,
} from "../unit/fixtures/app-server.ts";
import { assert_equals } from "../unit/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Effect, Schema } from "effect";
import { afterEach, test } from "vitest";

type NativeEntry = {
	readonly arg: unknown;
	readonly query: NativeBoundQuery;
	readonly ignore?: () => void;
};

type NativeBoundQuery = Promise<unknown> & {
	readonly refresh: () => Promise<void>;
	readonly set: (value: unknown) => void;
};

type Calls = {
	readonly refreshed: unknown[];
	readonly set: Array<readonly [unknown, unknown]>;
	readonly ignored: unknown[];
	readonly requested: Array<readonly [unknown, number]>;
	readonly all: string[];
};

afterEach(() => {
	reset_test_query();
	reset_test_requested();
});

function make_bound_query(arg: unknown, calls: Calls): NativeBoundQuery {
	return Object.assign(Promise.resolve([`post:${String(arg)}`]), {
		refresh: () => {
			calls.refreshed.push(arg);

			return Promise.resolve();
		},
		set: (value: unknown) => {
			calls.set.push([arg, value]);
		},
	});
}

function install_native(args: readonly unknown[], options: { readonly kit_2?: boolean } = {}) {
	const calls: Calls = { refreshed: [], set: [], ignored: [], requested: [], all: [] };
	const native_query = Object.assign(() => Promise.resolve([]), {
		__: { type: "query" },
	});

	set_test_query(() => native_query);
	set_test_requested((query, limit) => {
		calls.requested.push([query, limit as number]);

		const entries: NativeEntry[] = args.slice(0, limit as number).map((arg) => ({
			arg,
			query: make_bound_query(arg, calls),
			...(options.kit_2 ? {} : { ignore: () => calls.ignored.push(arg) }),
		}));

		return {
			async *[Symbol.asyncIterator]() {
				yield* entries;
			},
			refreshAll: async () => {
				calls.all.push("refreshAll");
			},
			...(options.kit_2
				? {}
				: {
						ignoreAll: async () => {
							calls.all.push("ignoreAll");
						},
					}),
		};
	});

	return { calls, native_query };
}

test("Requested passes the native query function and limit to SvelteKit", async () => {
	const { calls, native_query } = install_native(["a"]);
	const GetPosts = ServerQuery(Schema.String, (filter) => Effect.succeed([filter]));

	await get_server_dispatcher().run(Requested(GetPosts, 5));

	assert_equals(calls.requested, [[native_query, 5]]);
});

test("Requested entries expose validated args, Effect refresh and set, and ignore", async () => {
	const { calls } = install_native(["a", "b", "c"]);
	const GetPosts = ServerQuery(Schema.String, (filter) => Effect.succeed([filter]));

	const values = await get_server_dispatcher().run(
		Effect.gen(function* () {
			const entries = yield* Requested(GetPosts, 3);
			const results: unknown[] = [];

			for (const { arg, query, ignore } of entries) {
				if (arg === "a") {
					yield* query.refresh();
				} else if (arg === "b") {
					query.set([`set:${arg}`]);
				} else {
					yield* ignore;
				}

				results.push(yield* query);
			}

			return results;
		}),
	);

	assert_equals(calls.refreshed, ["a"]);
	assert_equals(calls.set, [["b", ["set:b"]]]);
	assert_equals(calls.ignored, ["c"]);
	assert_equals(values, [["post:a"], ["post:b"], ["post:c"]]);
});

test("Requested ignore is a no-op on SvelteKit 2 entries without ignore", async () => {
	const { calls } = install_native(["a"], { kit_2: true });
	const GetPosts = ServerQuery(Schema.String, (filter) => Effect.succeed([filter]));

	await get_server_dispatcher().run(
		Effect.gen(function* () {
			for (const { ignore } of yield* Requested(GetPosts, 1)) {
				yield* ignore;
			}
		}),
	);

	assert_equals(calls.ignored, []);
});

test("Requested.refreshAll and ignoreAll delegate to SvelteKit", async () => {
	const { calls } = install_native(["a"]);
	const GetPosts = ServerQuery(Schema.String, (filter) => Effect.succeed([filter]));

	await get_server_dispatcher().run(
		Effect.gen(function* () {
			yield* Requested.refreshAll(GetPosts, 1);
			yield* Requested.ignoreAll(GetPosts, 1);
		}),
	);

	assert_equals(calls.all, ["refreshAll", "ignoreAll"]);
});

test("Requested.ignoreAll drains the requests on SvelteKit 2", async () => {
	const { calls } = install_native(["a", "b"], { kit_2: true });
	const GetPosts = ServerQuery(Schema.String, (filter) => Effect.succeed([filter]));

	await get_server_dispatcher().run(Requested.ignoreAll(GetPosts, 2));

	assert_equals(calls.all, []);
	assert_equals(calls.requested.length, 1);
});
