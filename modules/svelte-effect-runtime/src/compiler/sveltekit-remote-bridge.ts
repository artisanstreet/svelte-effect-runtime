const sveltekit_remote_runtime_suffix =
	"/node_modules/@sveltejs/kit/src/runtime/client/remote-functions/index.js";

const expected_sveltekit_remote_exports = [
	["command", "./command.svelte.js"],
	["form", "./form.svelte.js"],
	["prerender", "./prerender.svelte.js"],
	["query", "./query/index.js"],
	["query_batch", "./query-batch.svelte.js"],
	["query_live", "./query-live/index.js"],
] as const;

const sveltekit_remote_bridge_exports = [
	`export { remote_request as __SER___remote_request } from './shared.svelte.js';`,
	`export { serialize_binary_form as __SER___serialize_binary_form, BINARY_FORM_CONTENT_TYPE as __SER___binary_form_content_type } from '../../form-utils.js';`,
] as const;

const sveltekit_remote_bridge_names = [
	"__SER___remote_request",
	"__SER___serialize_binary_form",
	"__SER___binary_form_content_type",
] as const;

export function is_sveltekit_remote_runtime_index(id: string): boolean {
	const [filename] = id.split("?", 2);
	const normalized_filename = filename.replaceAll("\\", "/");

	return normalized_filename.endsWith(sveltekit_remote_runtime_suffix);
}

export function append_sveltekit_remote_transport_bridge(code: string): string {
	const has_complete_bridge = sveltekit_remote_bridge_exports.every((statement) =>
		code.includes(statement),
	);
	const present_bridge_names = sveltekit_remote_bridge_names.filter((name) =>
		code.includes(name),
	);

	if (has_complete_bridge) {
		return code;
	}

	if (present_bridge_names.length > 0) {
		throw new Error(
			make_unsupported_sveltekit_remote_runtime_message(
				`found an incomplete SER transport bridge (${present_bridge_names.join(", ")})`,
			),
		);
	}

	const missing_exports = expected_sveltekit_remote_exports
		.filter(([name, source]) => !has_named_reexport(code, name, source))
		.map(([name, source]) => `${name} from ${source}`);

	if (missing_exports.length > 0) {
		throw new Error(
			make_unsupported_sveltekit_remote_runtime_message(
				`missing ${missing_exports.join(", ")}`,
			),
		);
	}

	return `${code.trimEnd()}\n${sveltekit_remote_bridge_exports.join("\n")}\n`;
}

export function make_missing_sveltekit_remote_runtime_message(): string {
	return make_unsupported_sveltekit_remote_runtime_message(
		"the generated client used a remote form, but the Kit client runtime index was not found",
	);
}

function has_named_reexport(code: string, name: string, source: string): boolean {
	const escaped_name = escape_regular_expression(name);
	const escaped_source = escape_regular_expression(source);
	const pattern = new RegExp(
		`export\\s*\\{\\s*${escaped_name}\\s*\\}\\s*from\\s*["']${escaped_source}["']\\s*;?`,
	);

	return pattern.test(code);
}

function escape_regular_expression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function make_unsupported_sveltekit_remote_runtime_message(reason: string): string {
	return [
		"Unsupported @sveltejs/kit remote client runtime.",
		reason,
		"SER expects the remote runtime layout used by SvelteKit 2.69.x and 3.0.0-next.x.",
	].join(" ");
}
