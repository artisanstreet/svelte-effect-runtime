import { MakePipeline, PrepareSource, type PreparedSource } from "../pipeline.ts";
import { InstallUpstreamAdapter } from "./upstream.ts";
import { SvelteCheck } from "svelte-language-server";
import { map_diagnostics } from "./diagnostics.ts";
import { Effect, FileSystem, Path } from "effect";
import { pathToFileURL } from "node:url";

import ts from "typescript";

export interface CheckOptions {
	workspace: string;
	tsconfig: string;
	mode: string;
}

/** One-shot preparation runs before TypeScript's synchronous snapshot callbacks. */
export const CheckProject = (options: CheckOptions) =>
	Effect.scoped(
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const pipeline = yield* MakePipeline(options.workspace, options.mode);
			const sources = new Map<string, PreparedSource>();
			const pending = new Set<string>();
			const tsconfig = path.resolve(options.workspace, options.tsconfig);
			const config = yield* Effect.try(() => ts.readConfigFile(tsconfig, ts.sys.readFile));

			if (config.error) {
				return yield* Effect.fail(
					new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n")),
				);
			}

			const project = yield* Effect.try(() =>
				ts.parseJsonConfigFileContent(
					config.config,
					ts.sys,
					path.dirname(tsconfig),
					undefined,
					tsconfig,
					undefined,
					[
						{
							extension: ".svelte",
							isMixedContent: true,
							scriptKind: ts.ScriptKind.Deferred,
						},
					],
				),
			);
			const filenames = project.fileNames.filter((filename) => filename.endsWith(".svelte"));

			/** Prepare the workspace before upstream builds any component snapshots. */
			for (const filename of filenames) {
				const original = yield* file_system.readFileString(filename);
				const prepared = yield* PrepareSource(pipeline, filename, original);

				sources.set(filename.replaceAll("\\", "/"), prepared);
			}

			yield* InstallUpstreamAdapter(sources, pending, pipeline.compiler_options);

			const checker = new SvelteCheck(options.workspace, {
				tsconfig,
				watch: false,
			});
			const internals = checker as unknown as {
				lsAndTSDocResolver: {
					lsDocumentContext: { ambientTypesSource: string };
					updateExistingSvelteFile(filename: string): Promise<void>;
				};
			};

			/** The standalone engine lacks svelte-check's bundled shims; use its own svelte2tsx dependency. */
			internals.lsAndTSDocResolver.lsDocumentContext.ambientTypesSource = "svelte2tsx";

			for (const [filename, prepared] of sources) {
				yield* Effect.tryPromise(() =>
					checker.upsertDocument(
						{ uri: pathToFileURL(filename).href, text: prepared.code },
						true,
					),
				);
			}

			/** Imported components outside the initial crawl are prepared before results are accepted. */
			while (true) {
				const diagnostics = yield* Effect.tryPromise(() => checker.getDiagnostics());
				const discovered = [...pending].filter((filename) => !sources.has(filename));

				pending.clear();

				if (discovered.length === 0) {
					return diagnostics
						.filter(
							(file) =>
								file.diagnostics.length > 0 ||
								sources.has(file.filePath.replaceAll("\\", "/")),
						)
						.map((file) =>
							map_diagnostics(file, sources.get(file.filePath.replaceAll("\\", "/"))),
						);
				}

				for (const filename of discovered) {
					const original = yield* file_system.readFileString(filename);
					const prepared = yield* PrepareSource(pipeline, filename, original);

					sources.set(filename, prepared);
					yield* Effect.tryPromise(() =>
						internals.lsAndTSDocResolver.updateExistingSvelteFile(filename),
					);
					yield* Effect.tryPromise(() =>
						checker.upsertDocument(
							{ uri: pathToFileURL(filename).href, text: prepared.code },
							false,
						),
					);
				}
			}
		}),
	);
