import type { CompileOptions, PreprocessorGroup } from "svelte/compiler";
import type { Rolldown, ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Effect, Path } from "effect";

interface SvelteApi {
	options: {
		compilerOptions: CompileOptions;
		preprocess?: PreprocessorGroup | PreprocessorGroup[];
		extensions: string[];
	};
}

export interface PreparedSource {
	code: string;
	map: Record<string, unknown>;
	original: string;
}

export interface Pipeline {
	server: ViteDevServer;
	compiler_options: CompileOptions;
	extensions: readonly string[];
	captures: Map<string, Omit<PreparedSource, "original">>;
}

class CaptureStop extends Error {}

export const MakePipeline = (workspace: string, mode: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const require_from_project = createRequire(path.join(workspace, "package.json"));
		const vite_path = yield* Effect.try(() => require_from_project.resolve("vite"));
		const vite: typeof import("vite") = yield* Effect.tryPromise(
			() => import(pathToFileURL(vite_path).href),
		);
		const server = yield* Effect.acquireRelease(
			Effect.tryPromise(() =>
				vite.createServer({
					root: workspace,
					mode,
					logLevel: "error",
					server: { middlewareMode: true, hmr: false, ws: false, watch: null },
					optimizeDeps: { noDiscovery: true, include: [] },
				}),
			),
			(server) => Effect.promise(() => server.close()),
		);
		const boundary = server.config.plugins.find(
			(plugin) => plugin.name === "vite-plugin-svelte:compile",
		);
		const config_plugin = server.config.plugins.find(
			(plugin) => plugin.name === "vite-plugin-svelte:config",
		);
		const api = config_plugin?.api as SvelteApi | undefined;

		if (!boundary?.transform || !api?.options) {
			return yield* Effect.fail(
				new Error(
					"The MVP requires vite-plugin-svelte 7 and its component compilation hook.",
				),
			);
		}

		if (api.options.extensions.some((extension) => extension !== ".svelte")) {
			return yield* Effect.fail(
				new Error("The MVP currently supports only the .svelte component extension."),
			);
		}

		/** Preserve TypeScript for svelte2tsx while retaining Vite markup/style preprocessing. */
		for (const preprocessor of [api.options.preprocess]
			.flat()
			.filter((value) => value !== undefined)) {
			if (!preprocessor.script) {
				continue;
			}

			/** SvelteKit's warning-only script hook does not transform component source. */
			if (preprocessor.name === "sveltekit:warnings") {
				continue;
			}

			if (preprocessor.name !== "vite-preprocess") {
				return yield* Effect.fail(
					new Error(
						`Unsupported script preprocessor: ${preprocessor.name ?? "unnamed"}. The MVP cannot guarantee preservation of TypeScript types.`,
					),
				);
			}

			delete preprocessor.script;
		}

		const captures: Pipeline["captures"] = new Map();
		const capture = function (this: Rolldown.TransformPluginContext, code: string, id: string) {
			captures.set(id, {
				code,
				map: this.getCombinedSourcemap() as unknown as Record<string, unknown>,
			});

			throw new CaptureStop("Component source captured before compilation");
		};

		boundary.transform =
			typeof boundary.transform === "function"
				? capture
				: { ...boundary.transform, handler: capture };

		return {
			server,
			captures,
			compiler_options: api.options.compilerOptions,
			extensions: api.options.extensions,
		};
	});

export const PrepareSource = (pipeline: Pipeline, filename: string, original: string) =>
	Effect.gen(function* () {
		const id = filename.replaceAll("\\", "/");

		pipeline.captures.delete(id);

		/** Use Vite's container to preserve filters, contexts, ordering, and map composition. */
		yield* Effect.tryPromise({
			try: () => pipeline.server.environments.client!.pluginContainer.transform(original, id),
			catch: (cause) => cause,
		}).pipe(
			Effect.catch((cause) =>
				cause instanceof CaptureStop ? Effect.void : Effect.fail(cause),
			),
		);

		const captured = pipeline.captures.get(id);

		if (!captured) {
			return yield* Effect.fail(
				new Error(`Vite did not reach the component compilation boundary for ${filename}.`),
			);
		}

		return { ...captured, original };
	});
