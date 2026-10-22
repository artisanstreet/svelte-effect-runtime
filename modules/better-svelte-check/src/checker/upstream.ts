import type { CompileOptions } from "svelte/compiler";
import type { PreparedSource } from "../pipeline.ts";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Effect } from "effect";

import type ts from "typescript";

interface ConfigLoader {
	getConfig(filename: string): unknown;
	awaitConfig(filename: string): Promise<unknown>;
	loadConfigs(directory: string): Promise<void>;
}

interface SnapshotFactory {
	fromDocument(
		document: {
			getFilePath(): string | null;
			getText(): string;
			setText(content: string): void;
		},
		options: unknown,
	): unknown;
	fromSvelteFilePath(
		filename: string,
		create_document: (filename: string, content: string) => unknown,
		options: unknown,
		ts_system: ts.System,
	): unknown;
}

const require = createRequire(import.meta.url);

/** The MVP pins these upstream internals and restores its process-wide adapters on exit. */
export const InstallUpstreamAdapter = (
	sources: Map<string, PreparedSource>,
	pending: Set<string>,
	compiler_options: CompileOptions,
) =>
	Effect.acquireRelease(
		Effect.try(() => {
			const upstream_root = dirname(require.resolve("svelte-language-server"));
			const { configLoader } = require(
				join(upstream_root, "lib/documents/configLoader.js"),
			) as { configLoader: ConfigLoader };
			const { DocumentSnapshot: snapshot } = require(
				join(upstream_root, "plugins/typescript/DocumentSnapshot.js"),
			) as { DocumentSnapshot: SnapshotFactory };
			const original_get_config = configLoader.getConfig;
			const original_await_config = configLoader.awaitConfig;
			const original_load_configs = configLoader.loadConfigs;
			const original_from_file = snapshot.fromSvelteFilePath;
			const original_from_document = snapshot.fromDocument;
			const config = { compilerOptions: compiler_options, preprocess: [] };

			configLoader.getConfig = () => config;
			configLoader.awaitConfig = () => Promise.resolve(config);
			configLoader.loadConfigs = () => Promise.resolve();
			snapshot.fromDocument = (document, options) => {
				const filename = document.getFilePath()?.replaceAll("\\", "/");
				const prepared = filename ? sources.get(filename) : undefined;

				if (filename && !prepared) {
					pending.add(filename);
				}

				if (prepared && document.getText() !== prepared.code) {
					document.setText(prepared.code);
				}

				return original_from_document(document, options);
			};
			snapshot.fromSvelteFilePath = (filename, create_document, options, ts_system) => {
				const prepared = sources.get(filename);

				if (!prepared) {
					pending.add(filename);
				}

				return original_from_file(filename, create_document, options, {
					...ts_system,
					readFile: (path) =>
						path === filename && prepared ? prepared.code : ts_system.readFile(path),
				});
			};

			return () => {
				configLoader.getConfig = original_get_config;
				configLoader.awaitConfig = original_await_config;
				configLoader.loadConfigs = original_load_configs;
				snapshot.fromSvelteFilePath = original_from_file;
				snapshot.fromDocument = original_from_document;
			};
		}),
		(restore) => Effect.sync(restore),
	);
