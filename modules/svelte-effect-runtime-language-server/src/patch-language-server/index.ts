import {
	PatchSvelteCompilerPath,
	PatchSvelteFileExtensions,
	PatchTypeScriptCodeActions,
	PatchTypeScriptSnapshotPath,
} from "./patches.ts";
import {
	RuntimeTransforms,
	RuntimeTransformsLive,
	SvelteInternalsLive,
} from "./svelte-internals.ts";
import { normalize_transform_result } from "./transform-results.ts";
import { Effect, Layer } from "effect";

/**
 * Live private-module dependencies required by the language-server bootstrap.
 *
 * @example
 * ```ts
 * const program = Bootstrap.pipe(
 * 	Effect.provide(LanguageServerLive),
 * 	Effect.provide(NodeServices.layer),
 * );
 * ```
 *
 * @since 4.0.1
 */
export const LanguageServerLive = Layer.merge(SvelteInternalsLive, RuntimeTransformsLive);

/**
 * Installs the SER compiler, snapshot, file-extension, and code-action patches
 * into the Svelte language server process.
 *
 * @example
 * ```ts
 * yield* Bootstrap;
 * start_language_server();
 * ```
 *
 * @since 1.0.0
 * @returns An Effect that installs every language-server patch, or completes
 *   immediately when the process is already patched.
 */
export const Bootstrap = Effect.gen(function* () {
	const runtime_transforms = yield* RuntimeTransforms;

	yield* PatchSvelteFileExtensions();
	yield* PatchSvelteCompilerPath(runtime_transforms.transform_svelte_effect);
	yield* PatchTypeScriptSnapshotPath({
		transformEffectMarkup: (code, options) =>
			normalize_transform_result(
				runtime_transforms.transform_markup_effect(code, options.filename, {
					target: "editor",
				}),
				code,
				options.filename,
			),
		transformEffectScript: (code, options) =>
			normalize_transform_result(
				runtime_transforms.transform_script_effect(code, options.filename),
				code,
				options.filename,
			),
	});
	yield* PatchTypeScriptCodeActions();
});
