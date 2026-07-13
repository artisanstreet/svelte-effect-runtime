import {
	type Connection,
	createConnection,
	IPCMessageReader,
	IPCMessageWriter,
} from "vscode-languageserver/node";
import { Bootstrap, LanguageServerLive } from "./patch-language-server/index.ts";
import { DocumentDiagnosticRequest } from "vscode-languageserver";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { startServer } from "svelte-language-server";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

import process from "node:process";
import path from "node:path";

const MakeLanguageServerConnection = Effect.gen(function* () {
	if (process.argv.includes("--stdio")) {
		yield* Effect.sync(() => {
			console.log = (...args) => {
				console.warn(...args);
			};
		});

		const connection = yield* Effect.sync(
			() => createConnection(process.stdin, process.stdout) as Connection,
		);

		return yield* PatchPullDiagnosticsConnection(connection);
	}

	const connection = yield* Effect.sync(
		() =>
			createConnection(
				new IPCMessageReader(process),
				new IPCMessageWriter(process),
			) as Connection,
	);

	return yield* PatchPullDiagnosticsConnection(connection);
});

const Main = Effect.gen(function* () {
	yield* Bootstrap;

	const connection = yield* MakeLanguageServerConnection;

	yield* Effect.sync(() => {
		startServer({ connection });
	});

	yield* Effect.never;
});

if (is_main_module()) {
	NodeRuntime.runMain(
		Main.pipe(Effect.provide(LanguageServerLive), Effect.provide(NodeServices.layer)),
	);
}

function PatchPullDiagnosticsConnection(connection: Connection) {
	return Effect.gen(function* () {
		return yield* Effect.sync(() => {
			const original_on_request = connection.onRequest.bind(connection);

			connection.onRequest = ((type_or_method: unknown, handler: unknown) => {
				const method =
					typeof type_or_method === "string"
						? type_or_method
						: (type_or_method as { method?: string })?.method;

				if (method !== DocumentDiagnosticRequest.method || typeof handler !== "function") {
					return original_on_request(type_or_method as never, handler as never);
				}

				const wrapped_handler = async (...args: unknown[]) => {
					const result = await (handler as (...args: unknown[]) => unknown)(...args);

					return result ?? { kind: "full", items: [] };
				};

				return original_on_request(type_or_method as never, wrapped_handler as never);
			}) as typeof connection.onRequest;

			return connection;
		});
	});
}

function is_main_module(): boolean {
	const invoked_module = process.argv[1];
	const current_module_path = fileURLToPath(import.meta.url);

	if (invoked_module === undefined) {
		return false;
	}

	const invoked_module_path = path.resolve(invoked_module);
	const current_identity = normalize_entry_path(current_module_path);
	const invoked_identity = normalize_entry_path(invoked_module_path);

	if (current_identity === invoked_identity) {
		return true;
	}

	/** Node resolves linked entry modules to their real path before evaluation. */
	return get_entry_path_tail(current_identity, 3) === get_entry_path_tail(invoked_identity, 3);
}

function normalize_entry_path(module_path: string): string {
	const normalized = path.normalize(module_path);

	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function get_entry_path_tail(module_path: string, segment_count: number): string {
	return module_path.split(path.sep).slice(-segment_count).join(path.sep);
}

export { Bootstrap, LanguageServerLive };
