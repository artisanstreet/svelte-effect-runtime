import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startServer } from "svelte-language-server";
import { bootstrap_language_server } from "./patch-language-server.ts";

const is_main_module = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_main_module) {
  void bootstrap_language_server()
    .then(() => {
      startServer();
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { bootstrap_language_server };
