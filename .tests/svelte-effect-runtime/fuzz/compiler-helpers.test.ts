import {
	append_sveltekit_remote_transport_bridge,
	is_sveltekit_remote_runtime_index,
} from "../../../modules/svelte-effect-runtime/src/compiler/sveltekit-remote-bridge.ts";
import { collect_markup_identifier_names } from "../../../modules/svelte-effect-runtime/src/compiler/markup-identifiers.ts";
import { rewrite_remote_client_exports } from "../../../modules/svelte-effect-runtime/src/compiler/remote-client.ts";
import { scan_svelte_effect_source } from "../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import { DefineEnvVars } from "../../../modules/svelte-effect-runtime/src/environment.ts";
import { make_invalid_proxy } from "../../../modules/svelte-effect-runtime/src/server/invalid.ts";
import { component_arbitrary, render_component } from "./grammar/component.ts";
import { Effect, Exit, Schema } from "effect";
import { expect, test } from "vitest";

import * as fc from "fast-check";

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 40);

const kit_remote_suffix =
	"/node_modules/@sveltejs/kit/src/runtime/client/remote-functions/index.js";

/**
 * A well-formed Kit client runtime index. The bridge only appends to a module
 * that re-exports every remote entry point it expects, so the fixture has to
 * carry all of them.
 */
const kit_runtime_source = [
	`export { command } from './command.svelte.js';`,
	`export { form } from './form.svelte.js';`,
	`export { prerender } from './prerender.svelte.js';`,
	`export { query } from './query/index.js';`,
	`export { query_batch } from './query-batch.svelte.js';`,
	`export { query_live } from './query-live/index.js';`,
].join("\n");

/**
 * Module ids reach the plugin with platform separators and Vite query suffixes
 * attached, so recognition has to survive both.
 */
test(
	"the Kit remote runtime index is recognised through separators and queries",
	() => {
		fc.assert(
			fc.property(
				fc.array(
					fc.webSegment().filter((segment) => segment.length > 0),
					{
						minLength: 1,
						maxLength: 4,
					},
				),
				fc.boolean(),
				fc.option(fc.constantFrom("?v=1", "?import", "?t=123&import"), { nil: undefined }),
				(segments, windows_separators, query) => {
					const prefix = `/${segments.join("/")}`;
					const posix_id = `${prefix}${kit_remote_suffix}${query ?? ""}`;
					const id = windows_separators ? posix_id.replaceAll("/", "\\") : posix_id;

					expect(is_sveltekit_remote_runtime_index(id), id).toBe(true);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"unrelated module ids are never mistaken for the Kit remote runtime",
	() => {
		fc.assert(
			fc.property(fc.string(), (id) => {
				fc.pre(!id.replaceAll("\\", "/").split("?", 2)[0].endsWith(kit_remote_suffix));

				expect(is_sveltekit_remote_runtime_index(id), id).toBe(false);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * The bridge is appended during dependency optimisation, which can run more
 * than once over the same module. Appending twice must not stack a second copy
 * or trip the incomplete-bridge guard.
 */
test(
	"appending the transport bridge is idempotent",
	() => {
		fc.assert(
			fc.property(fc.nat({ max: 4 }), fc.boolean(), (extra_lines, trailing_newline) => {
				const padding = Array.from(
					{ length: extra_lines },
					(_, index) => `export const spare_${index} = ${index};`,
				);
				const source =
					[kit_runtime_source, ...padding].join("\n") + (trailing_newline ? "\n" : "");

				const once = append_sveltekit_remote_transport_bridge(source);
				const twice = append_sveltekit_remote_transport_bridge(once);

				expect(twice).toBe(once);
				expect(once.length).toBeGreaterThan(source.length);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"a Kit runtime missing an expected export is refused by name",
	() => {
		const expected_exports = [
			"command",
			"form",
			"prerender",
			"query",
			"query_batch",
			"query_live",
		] as const;

		fc.assert(
			fc.property(fc.constantFrom(...expected_exports), (dropped) => {
				const source = kit_runtime_source
					.split("\n")
					.filter((line) => !new RegExp(`export \\{ ${dropped} \\}`).test(line))
					.join("\n");

				expect(() => append_sveltekit_remote_transport_bridge(source)).toThrow(
					new RegExp(dropped),
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Identifier collection feeds generated closures, so it runs over whatever the
 * scanner produced for a component — including the opaque fallback.
 */
test(
	"markup identifier collection never throws and keeps every binding",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render_component(spec);
				const scan = scan_svelte_effect_source(source, "Fuzz.svelte");

				let names: ReadonlySet<string> | undefined;

				expect(() => {
					names = collect_markup_identifier_names(scan);
				}, source).not.toThrow();

				for (const binding of scan.markup_binding_names) {
					expect(names?.has(binding), `${binding} missing from ${source}`).toBe(true);
				}

				expect(names?.has("__SER___markup_identifiers")).toBe(false);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"rewriting remote client exports is idempotent and total",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render_component(spec);

				let once: string | undefined;

				expect(() => {
					once = rewrite_remote_client_exports(source);
				}, source).not.toThrow();

				expect(rewrite_remote_client_exports(once ?? source), source).toBe(once);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * `invalid.email("...")` builds a form issue whose path mirrors the property
 * access chain. Numeric segments below the first become array indices, so a
 * nested field path survives round-tripping into the client's form state.
 */
test(
	"the invalid proxy records the property path it was accessed through",
	async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(
					fc.webSegment().filter((segment) => /^[A-Za-z_$][\w$]*$/.test(segment)),
					{
						minLength: 1,
						maxLength: 4,
					},
				),
				fc.string(),
				async (path, message) => {
					let node: unknown = make_invalid_proxy();

					for (const segment of path) {
						node = (node as Record<string, unknown>)[segment];
					}

					const exit = await Effect.runPromiseExit(
						(node as (value: string) => Effect.Effect<never, unknown>)(message),
					);

					expect(Exit.isFailure(exit)).toBe(true);

					const failure = Exit.isFailure(exit)
						? (exit.cause.reasons.find((reason) => "error" in reason) as
								| { error: { issues: Array<{ message: string; path: unknown[] }> } }
								| undefined)
						: undefined;

					expect(failure?.error.issues[0]?.message).toBe(message);
					expect(failure?.error.issues[0]?.path).toEqual(path);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"the invalid proxy treats index access below the root as an array index",
	() => {
		fc.assert(
			fc.property(
				fc.webSegment().filter((segment) => /^[A-Za-z_$][\w$]*$/.test(segment)),
				fc.nat({ max: 20 }),
				(field, index) => {
					const proxy = make_invalid_proxy() as unknown as Record<
						string,
						Record<string, (message: string) => Effect.Effect<never, unknown>>
					>;

					const issue = Effect.runSyncExit(proxy[field][String(index)]("bad"));
					const failure = Exit.isFailure(issue)
						? (issue.cause.reasons.find((reason) => "error" in reason) as
								| { error: { issues: Array<{ path: unknown[] }> } }
								| undefined)
						: undefined;

					expect(failure?.error.issues[0]?.path).toEqual([field, index]);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * `DefineEnvVars` converts Effect Schemas to Standard Schemas and leaves every
 * other declaration untouched. Running it twice must not convert twice.
 */
test(
	"defining environment variables preserves metadata and is idempotent",
	() => {
		fc.assert(
			fc.property(
				fc.dictionary(
					fc.webSegment().filter((segment) => /^[A-Z][A-Z0-9_]*$/i.test(segment)),
					fc.record({
						public: fc.boolean(),
						static: fc.boolean(),
						description: fc.string(),
						schema: fc.constantFrom(
							Schema.String,
							Schema.Number,
							Schema.Boolean,
							undefined,
						),
					}),
					{ maxKeys: 5 },
				),
				(definition) => {
					const once = DefineEnvVars(definition);
					const twice = DefineEnvVars(once);

					expect(Object.keys(once)).toEqual(Object.keys(definition));

					for (const [name, variable] of Object.entries(definition)) {
						const normalized = once[name];

						expect(normalized.public).toBe(variable.public);
						expect(normalized.static).toBe(variable.static);
						expect(normalized.description).toBe(variable.description);
						expect(normalized.schema === undefined).toBe(variable.schema === undefined);
					}

					for (const name of Object.keys(once)) {
						expect(twice[name].schema).toBe(once[name].schema);
					}
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);
