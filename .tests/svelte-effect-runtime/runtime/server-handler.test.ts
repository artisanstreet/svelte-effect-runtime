import { reset_test_request_event, set_test_request_event } from "./fixtures/app-server.ts";
import {
	Error as HandlerError,
	Handler,
	Redirect,
	RequestEvent,
	ServerRuntime,
} from "../../../modules/svelte-effect-runtime/src/server.ts";
import { reset_server_runtime } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { assert_equals, assert_rejects, assert_truthy } from "./helpers/assert.ts";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { afterEach, test } from "vitest";
import { Context, Effect, Layer } from "effect";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

afterEach(() => {
	reset_test_request_event();
	reset_server_runtime();
});

test("Handler runs Effect callbacks with every native argument", async () => {
	type NativeHandler = (prefix: string, value: number) => Promise<{ readonly text: string }>;

	const handler = Handler<NativeHandler>((prefix, value) =>
		Effect.succeed({ text: `${prefix}:${value}` }),
	);

	set_test_request_event(make_request_event("http://localhost/effect"));

	const result = await handler("count", 42);

	assert_equals(result, { text: "count:42" });
});

test("Handler runs direct generator callbacks", async () => {
	type NativeHandler = (value: number) => Promise<number>;

	const handler = Handler<NativeHandler>(function* (value) {
		const offset = yield* Effect.succeed(2);

		return value + offset;
	});

	set_test_request_event(make_request_event("http://localhost/generator"));

	assert_equals(await handler(40), 42);
});

test("Handler captures and provides the request event before running the callback", async () => {
	type NativeHandler = () => Promise<string>;

	const first_event = make_request_event("http://localhost/first");
	const second_event = make_request_event("http://localhost/second");
	const handler = Handler<NativeHandler>(function* () {
		set_test_request_event(second_event);

		const event = yield* RequestEvent;

		return event.url.pathname;
	});

	set_test_request_event(first_event);

	assert_equals(await handler(), "/first");
});

test("Handler runs through the configured ServerRuntime Layer", async () => {
	type NativeHandler = () => Promise<string>;

	const TestService = Context.Service<{ readonly value: string }>("TestService");
	const handler = Handler<NativeHandler>(function* () {
		const service = yield* TestService;

		return service.value;
	});

	ServerRuntime.make(Layer.succeed(TestService, { value: "configured" }));
	set_test_request_event(make_request_event("http://localhost/layer"));

	assert_equals(await handler(), "configured");
});

test("Handler preserves SvelteKit HTTP error control flow", async () => {
	type NativeHandler = () => Promise<Response>;

	const handler = Handler<NativeHandler>(function* () {
		return yield* HandlerError("NotFound", "missing");
	});

	set_test_request_event(make_request_event("http://localhost/missing"));

	const thrown = await assert_rejects(() => handler());

	assert_truthy(isHttpError(thrown, 404));
	assert_equals(thrown.body, { message: "missing", status: 404 });
});

test("Handler preserves SvelteKit redirect control flow", async () => {
	type NativeHandler = () => Promise<Response>;

	const handler = Handler<NativeHandler>(function* () {
		return yield* Redirect("SeeOther", "/sign-in");
	});

	set_test_request_event(make_request_event("http://localhost/private"));

	const thrown = await assert_rejects(() => handler());

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "/sign-in");
});

test("Handler rejects with ordinary Effect defects unchanged", async () => {
	type NativeHandler = () => Promise<string>;

	const defect = new Error("handler exploded");
	const handler = Handler<NativeHandler>(() => Effect.die(defect));

	set_test_request_event(make_request_event("http://localhost/defect"));

	const thrown = await assert_rejects(() => handler());

	assert_equals(thrown, defect);
});

test("Handler preserves native argument and output types", async () => {
	await assert_type_checks(
		"server-handler-types.ts",
		`
import type { RequestHandler } from "@sveltejs/kit";
import { Context, Effect } from "effect";
import { Handler } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type { EffectHandler } from "__RUNTIME__/modules/svelte-effect-runtime/src/server.ts";
import type { PageServerLoad } from "./$types";

type NativeHandler = (
  input: { readonly id: string },
  count: number,
) => Promise<{ readonly key: string; readonly count: number }>;

const Prefix = Context.Service<{ readonly value: string }>("Prefix");
const callback: EffectHandler<NativeHandler> = function* (input, count) {
  const prefix = yield* Prefix;

  return { key: prefix.value + input.id, count };
};
const handler: NativeHandler = Handler<NativeHandler>(callback);
const GET: RequestHandler = Handler<RequestHandler>(({ url }) =>
  Effect.succeed(new Response(url.pathname))
);
const load: PageServerLoad = Handler<PageServerLoad>(function* ({ params, parent, route }) {
  const slug: string = params.slug;
  const route_id: "/posts/[slug]" = route.id;
  const parent_data = yield* Effect.promise(() => parent());
  const layout_name: string = parent_data.layout_name;

  return {
    post: { slug },
    parent_name: layout_name,
  };
});

const missing_load_output = Handler<PageServerLoad>(
  /** @ts-expect-error server load output must include parent_name */
  () => Effect.succeed({ post: { slug: "post" } })
);
const incorrect_load_output = Handler<PageServerLoad>(
  /** @ts-expect-error server load output must preserve the declared field types */
  () => Effect.succeed({ post: { slug: "post" }, parent_name: 42 })
);

async function check_types() {
  const result = await handler({ id: "post" }, 2);
  const key: string = result.key;
  const count: number = result.count;

  /** @ts-expect-error the adapted handler preserves every native argument */
  handler({ id: "post" });
  /** @ts-expect-error the adapted handler preserves the native input shape */
  handler({ slug: "post" }, 2);

  Handler<NativeHandler>(() =>
    /** @ts-expect-error successful output must match the awaited native output */
    Effect.succeed({ key: 123, count: "two" })
  );

  Handler<NativeHandler>(() =>
    /** @ts-expect-error typed failures must be resolved before the server boundary */
    Effect.fail("domain failure")
  );

  void key;
  void count;
  void GET;
  void load;
  void missing_load_output;
  void incorrect_load_output;
}

void check_types;
`,
	);
});

function make_request_event(url: string) {
	return {
		cookies: {
			delete() {},
			get() {
				return undefined;
			},
			getAll() {
				return [];
			},
			serialize() {
				return "";
			},
			set() {},
		},
		fetch,
		getClientAddress() {
			return "127.0.0.1";
		},
		isDataRequest: false,
		isRemoteRequest: false,
		locals: {},
		params: {},
		platform: undefined,
		request: new Request(url),
		route: { id: null },
		setHeaders() {},
		tracing: {
			current: {},
			root: {},
		},
		url: new URL(url),
	};
}

async function assert_type_checks(filename: string, source: string): Promise<void> {
	const repo_root = fileURLToPath(new URL("../../..", import.meta.url));
	const tmp_root = join(repo_root, ".tmp");

	await mkdir(tmp_root, { recursive: true });

	const dir = await mkdtemp(join(tmp_root, "server-handler-types-"));
	const app_server_path = join(dir, "$app-server.ts");
	const route_types_path = join(dir, "$types.ts");
	const source_path = join(dir, filename);
	const tsconfig_path = join(dir, "tsconfig.json");
	const node_modules_root = to_tsconfig_path(dir, join(repo_root, "node_modules"));
	const runtime_root = to_tsconfig_path(dir, join(repo_root, "modules", "svelte-effect-runtime"));

	/**
	 * Give the isolated compiler the SvelteKit virtual module used by Handler.
	 */
	await writeFile(
		app_server_path,
		`
import type { RequestEvent } from "@sveltejs/kit";

export function getRequestEvent(): RequestEvent {
  return undefined as unknown as RequestEvent;
}
`,
	);

	/**
	 * Model the generated route-local types supplied by SvelteKit.
	 */
	await writeFile(
		route_types_path,
		`
import type { ServerLoad } from "@sveltejs/kit";

export type PageServerLoad = ServerLoad<
  { slug: string },
  { layout_name: string },
  { post: { slug: string }; parent_name: string },
  "/posts/[slug]"
>;
`,
	);

	await writeFile(source_path, source.replaceAll("__RUNTIME__", to_posix_path(repo_root)));

	await writeFile(
		tsconfig_path,
		JSON.stringify(
			{
				compilerOptions: {
					allowImportingTsExtensions: true,
					exactOptionalPropertyTypes: true,
					ignoreDeprecations: "6.0",
					lib: ["dom", "dom.iterable", "es2022"],
					module: "esnext",
					moduleResolution: "bundler",
					noEmit: true,
					paths: {
						"@sveltejs/kit": [`${node_modules_root}/@sveltejs/kit`],
						"@sveltejs/kit/*": [`${node_modules_root}/@sveltejs/kit/*`],
						"$app/server": [to_tsconfig_path(dir, app_server_path)],
						$: [`${runtime_root}/src/mod.ts`],
						"$/*": [`${runtime_root}/src/*`],
						effect: [`${node_modules_root}/effect`],
						"effect/*": [`${node_modules_root}/effect/*`],
						svelte: [`${node_modules_root}/svelte`],
						"svelte/*": [`${node_modules_root}/svelte/*`],
					},
					skipLibCheck: true,
					strict: true,
					target: "es2022",
				},
				files: [to_posix_path(source_path)],
			},
			null,
			2,
		),
	);

	/**
	 * Compile the fixture and surface every diagnostic through the assertion.
	 */
	const output = spawnSync("vp", ["exec", "tsc", "-p", tsconfig_path], {
		cwd: repo_root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert_equals(output.status ?? 1, 0, `${output.stdout}${output.stderr}`);
}

function to_posix_path(path: string): string {
	return path.replaceAll("\\", "/");
}

function to_tsconfig_path(from: string, target: string): string {
	const relative_path = to_posix_path(relative(from, target));

	if (relative_path.startsWith(".")) {
		return relative_path;
	}

	return `./${relative_path}`;
}
