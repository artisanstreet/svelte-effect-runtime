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

export const LanguageServerLive = Layer.merge(SvelteInternalsLive, RuntimeTransformsLive);

/** Installs each SER language-server patch at most once per process. */
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
