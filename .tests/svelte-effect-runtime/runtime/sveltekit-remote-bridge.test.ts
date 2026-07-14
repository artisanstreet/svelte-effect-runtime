import {
	append_sveltekit_remote_transport_bridge,
	is_sveltekit_remote_runtime_index,
} from "../../../modules/svelte-effect-runtime/src/compiler/sveltekit-remote-bridge.ts";
import {
	assert_equals,
	assert_rejects,
	assert_string_includes,
	assert_throws,
} from "./helpers/assert.ts";
import { effect } from "../../../modules/svelte-effect-runtime/src/compiler.ts";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "vitest";

const bridge_export_statements = [
	`export { remote_request as __SER___remote_request } from './shared.svelte.js';`,
	`export { serialize_binary_form as __SER___serialize_binary_form, BINARY_FORM_CONTENT_TYPE as __SER___binary_form_content_type } from '../../form-utils.js';`,
] as const;

const supported_index_source = [
	`export { command } from './command.svelte.js';`,
	`export { form } from './form.svelte.js';`,
	`export { prerender } from './prerender.svelte.js';`,
	`export { query } from './query/index.js';`,
	`export { query_batch } from './query-batch.svelte.js';`,
	`export { query_live } from './query-live/index.js';`,
].join("\n");

const supported_runtime_id =
	"C:/repo/node_modules/@sveltejs/kit/src/runtime/client/remote-functions/index.js";

test("SvelteKit remote bridge appends the native transport exports once", () => {
	const rewritten = append_sveltekit_remote_transport_bridge(supported_index_source);

	for (const statement of bridge_export_statements) {
		assert_string_includes(rewritten, statement);
	}

	assert_equals(append_sveltekit_remote_transport_bridge(rewritten), rewritten);
});

test("SvelteKit remote bridge accepts installed Kit 2.69 and Kit 3 next runtimes", async () => {
	const workspace_root = fileURLToPath(new URL("../../../", import.meta.url));
	const pnpm_root = join(workspace_root, "node_modules", ".pnpm");
	const entries = await readdir(pnpm_root, { withFileTypes: true });
	const versions: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith("@sveltejs+kit@")) {
			continue;
		}

		const package_root = join(pnpm_root, entry.name, "node_modules", "@sveltejs", "kit");
		const package_json = JSON.parse(
			await readFile(join(package_root, "package.json"), "utf8"),
		) as { version?: unknown };
		const version = package_json.version;

		if (
			typeof version !== "string" ||
			(!version.startsWith("2.69.") && !version.startsWith("3.0.0-next."))
		) {
			continue;
		}

		const index_path = join(
			package_root,
			"src",
			"runtime",
			"client",
			"remote-functions",
			"index.js",
		);
		const source = await readFile(index_path, "utf8");
		const rewritten = append_sveltekit_remote_transport_bridge(source);

		versions.push(version);

		for (const statement of bridge_export_statements) {
			assert_string_includes(rewritten, statement, `SvelteKit ${version}`);
		}
	}

	assert_equals(
		versions.some((version) => version.startsWith("2.69.")),
		true,
	);
	assert_equals(
		versions.some((version) => version.startsWith("3.0.0-next.")),
		true,
	);
});

test("SvelteKit remote bridge recognizes resolved pnpm paths on both path separators", () => {
	assert_equals(is_sveltekit_remote_runtime_index(supported_runtime_id), true);
	assert_equals(
		is_sveltekit_remote_runtime_index(
			"C:\\repo\\node_modules\\.pnpm\\kit\\node_modules\\@sveltejs\\kit\\src\\runtime\\client\\remote-functions\\index.js?v=1",
		),
		true,
	);
	assert_equals(
		is_sveltekit_remote_runtime_index(
			"C:/repo/node_modules/@sveltejs/kit/src/runtime/client/remote-functions/form.svelte.js",
		),
		false,
	);
});

test("SvelteKit remote bridge rejects a changed runtime index shape", () => {
	const moved_source = supported_index_source.replace(
		`export { form } from './form.svelte.js';`,
		`export { form } from './form/index.js';`,
	);

	assert_throws(
		() => append_sveltekit_remote_transport_bridge(moved_source),
		Error,
		"missing form from ./form.svelte.js",
	);
});

test("remote client plugin injects the SvelteKit transport bridge", async () => {
	const plugin = get_remote_client_plugin();
	const result = await run_transform(plugin, supported_index_source, supported_runtime_id);

	if (!result || typeof result === "string") {
		throw new Error("remote client plugin should return bridge code");
	}

	for (const statement of bridge_export_statements) {
		assert_string_includes(result.code, statement);
	}
});

test("remote client plugin rejects a moved Kit virtual runtime during transformation", async () => {
	const plugin = get_remote_client_plugin();

	await assert_rejects(
		() =>
			run_transform(
				plugin,
				[
					`import * as __remote from '__sveltekit/remote';`,
					`export const create = __remote.form('abc/create');`,
				].join("\n"),
				"C:/repo/src/create.remote.js",
				{
					resolve() {
						return Promise.resolve({ id: "C:/kit/client/remote/index.js" });
					},
					error(message: unknown): never {
						throw new Error(String(message));
					},
				},
			),
		Error,
		"Kit client runtime index was not found",
	);
});

test("remote client plugin fails when a form build never sees the Kit runtime index", async () => {
	const plugin = get_remote_client_plugin();
	const build_start = plugin.buildStart;
	const build_end = plugin.buildEnd;

	if (typeof build_start !== "function" || typeof build_end !== "function") {
		throw new Error("remote client plugin should expose build guards");
	}

	await build_start.call({} as never);
	await run_transform(
		plugin,
		[
			`import * as __remote from '__sveltekit/remote';`,
			`const native_form = __remote.form('abc/create');`,
		].join("\n"),
		"C:/repo/src/create.remote.js",
		{
			resolve() {
				return Promise.resolve({ id: supported_runtime_id });
			},
		},
	);

	await assert_rejects(
		() =>
			build_end.call(
				{
					error(message: unknown): never {
						throw new Error(String(message));
					},
				} as never,
				undefined,
			),
		Error,
		"Kit client runtime index was not found",
	);
});

function get_remote_client_plugin(): ReturnType<typeof effect>[number] {
	const plugin = effect().find(
		(candidate) => candidate.name === "svelte-effect-runtime:remote-client",
	);

	if (!plugin) {
		throw new Error("remote client plugin should exist");
	}

	return plugin;
}

async function run_transform(
	plugin: ReturnType<typeof effect>[number],
	code: string,
	id: string,
	context: object = {},
) {
	const transform = plugin.transform;

	if (typeof transform !== "function") {
		throw new Error("remote client plugin should expose a transform hook");
	}

	return await transform.call(context as never, code, id);
}
