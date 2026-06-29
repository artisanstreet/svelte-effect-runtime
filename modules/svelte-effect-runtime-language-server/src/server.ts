import {
  type Connection,
  createConnection,
  IPCMessageReader,
  IPCMessageWriter,
} from "vscode-languageserver/node";
import { bootstrap_language_server } from "./patch-language-server/index.ts";
import { DocumentDiagnosticRequest } from "vscode-languageserver";
import { startServer } from "svelte-language-server";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

import process from "node:process";
import path from "node:path";

const current_module_path = realpathSync.native(fileURLToPath(import.meta.url));
const invoked_module_path = process.argv[1] === undefined
  ? undefined
  : realpathSync.native(path.resolve(process.argv[1]));
const is_main_module = invoked_module_path === current_module_path;

if (is_main_module) {
  void bootstrap_language_server()
    .then(() => {
      startServer({ connection: create_language_server_connection() });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

function create_language_server_connection(): Connection {
  if (process.argv.includes("--stdio")) {
    console.log = (...args) => {
      console.warn(...args);
    };

    const connection = createConnection(
      process.stdin,
      process.stdout,
    ) as Connection;

    return patch_pull_diagnostics_connection(connection);
  }

  const connection = createConnection(
    new IPCMessageReader(process),
    new IPCMessageWriter(process),
  ) as Connection;

  return patch_pull_diagnostics_connection(
    connection,
  );
}

function patch_pull_diagnostics_connection(
  connection: Connection,
): Connection {
  const original_on_request = connection.onRequest.bind(connection);

  connection.onRequest = ((type_or_method: unknown, handler: unknown) => {
    const method = typeof type_or_method === "string"
      ? type_or_method
      : (type_or_method as { method?: string })?.method;

    if (
      method !== DocumentDiagnosticRequest.method ||
      typeof handler !== "function"
    ) {
      return original_on_request(type_or_method as never, handler as never);
    }

    const wrapped_handler = async (...args: unknown[]) => {
      const result = await (handler as (...args: unknown[]) => unknown)(
        ...args,
      );

      return result ?? { kind: "full", items: [] };
    };

    return original_on_request(
      type_or_method as never,
      wrapped_handler as never,
    );
  }) as typeof connection.onRequest;

  return connection;
}

export { bootstrap_language_server };
