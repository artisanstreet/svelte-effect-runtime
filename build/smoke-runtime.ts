import { CommandName, RepoRoot, RemovePath, RunCommand } from "./node-utils.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path } from "effect";

const app_html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div>%sveltekit.body%</div>
  </body>
</html>
`;

const layout_svelte = `<slot />
`;

const page_svelte = `<script lang="ts" effect>
  import { Effect } from "effect";
  import {
    add_one,
    get_message,
    get_snapshot,
  } from "$lib/demo.remote";

  let script_value = $state("pending");
  let count = $state(yield* Effect.succeed(41));
  let query_value = $state("pending");
  let command_value = $state("pending");
  let prerender_value = $state("pending");

  script_value = yield* Effect.succeed("script effect ready");
  count = yield* Effect.succeed(count + 1);
  query_value = yield* get_message();
  command_value = yield* add_one();
  prerender_value = yield* get_snapshot();

  function click_effect() {
    return Effect.sync(() => {
      script_value = "clicked";
    });
  }
</script>

<main>
  <h1>ser current smoke</h1>
  <p data-testid="script">{script_value}</p>
  <p data-testid="count">{count}</p>
  <p data-testid="query">{query_value}</p>
  <p data-testid="command">{command_value}</p>
  <p data-testid="prerender">{prerender_value}</p>
  <p data-testid="markup">{yield* Effect.succeed("markup ready")}</p>

  {#await yield* Effect.succeed("await ready")}
    <p data-testid="await">loading</p>
  {:then value}
    <p data-testid="await">{value}</p>
  {/await}

  <ul data-testid="each">
    {#each yield* Effect.succeed(["a", "b", "c"]) as item}
      <li>{item}</li>
    {/each}
  </ul>

  <button data-testid="click" onclick={yield* click_effect()}>
    click
  </button>
</main>
`;

const demo_remote_ts = `import {
  Command,
  Prerender,
  Query,
} from "svelte-effect-runtime";
import { Effect } from "effect";

let count = 0;

export const get_message = Query(() =>
  Effect.succeed("query ready")
);

export const add_one = Command(() =>
  Effect.sync(() => {
    count += 1;

    return \`command ready \${count}\`;
  })
);

export const get_snapshot = Prerender(
  () => Effect.succeed("prerender ready"),
  { dynamic: true },
);
`;

const vite_config = `import { effect } from "svelte-effect-runtime/compiler";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import adapter from "@sveltejs/adapter-node";

const preview_port = Number(process.env.PORT ?? 4173);

export default defineConfig({
  preview: {
    host: process.env.HOST ?? "127.0.0.1",
    port: preview_port,
    strictPort: true,
  },
  plugins: [
    effect(),
    sveltekit({
      adapter: adapter(),
      compilerOptions: {
        experimental: {
          async: true,
        },
      },
      experimental: {
        remoteFunctions: true,
      },
    }),
  ],
});
`;

const playwright_config = `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  webServer: {
    command: "node preview-supervisor.mjs",
    url: "http://ser-current-smoke.localhost:1355",
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 5000,
    },
    env: {
      PORTLESS_HTTPS: "0",
      PORTLESS_PORT: "1355",
      PORTLESS_STATE_DIR: ".portless",
      PORTLESS_SYNC_HOSTS: "0",
    },
  },
  use: {
    baseURL: "http://ser-current-smoke.localhost:1355",
  },
});
`;

const preview_supervisor = `import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const portless_cli = fileURLToPath(
  new URL("./node_modules/portless/dist/cli.js", import.meta.url),
);
const children = new Set();
let stopping = false;
let proxy_ready = false;

function start(arguments_) {
  const child = spawn(process.execPath, [portless_cli, ...arguments_], {
    env: process.env,
    stdio: "inherit",
  });

  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    stop();
  });

  return child;
}

function wait_for_proxy(attempts = 100) {
  return new Promise((resolve, reject) => {
    const connect = (remaining) => {
      const socket = createConnection({ host: "127.0.0.1", port: 1355 });

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();

        if (remaining <= 1) {
          reject(new Error("Timed out waiting for the Portless smoke proxy."));

          return;
        }

        setTimeout(() => connect(remaining - 1), 100);
      });
    };

    connect(attempts);
  });
}

function stop() {
  if (stopping) {
    return;
  }

  stopping = true;

  for (const child of children) {
    child.kill();
  }

  setTimeout(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
  }, 2_000).unref();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const proxy = start([
  "proxy",
  "start",
  "--foreground",
  "--no-tls",
  "--port",
  "1355",
  "--skip-trust",
]);

proxy.once("exit", (code) => {
  if (!stopping) {
    if (!proxy_ready) {
      process.exit(code ?? 1);
    }

    process.exitCode = code ?? 1;
    stop();
  }
});

try {
  await wait_for_proxy();

  if (stopping) {
    process.exit(process.exitCode ?? 1);
  }

  proxy_ready = true;

  if (proxy.exitCode !== null) {
    process.exit(proxy.exitCode ?? 1);
  }

  const preview = start([
    "--name",
    "ser-current-smoke",
    "--force",
    "--",
    "vp",
    "exec",
    "vite",
    "preview",
  ]);

  preview.once("exit", (code) => {
    process.exitCode = code ?? 1;
    stop();
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  stop();
}
`;

const runtime_spec = `import { expect, test } from "@playwright/test";

test("current package drives script and markup effects", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("script")).toHaveText("script effect ready");
  await expect(page.getByTestId("count")).toHaveText("42");
  await expect(page.getByTestId("query")).toHaveText("query ready");
  await expect(page.getByTestId("command")).toHaveText("command ready 1");
  await expect(page.getByTestId("prerender")).toHaveText("prerender ready");
  await expect(page.getByTestId("markup")).toHaveText("markup ready");
  await expect(page.getByTestId("await")).toHaveText("await ready");
  await expect(page.getByTestId("each").locator("li")).toHaveText([
    "a",
    "b",
    "c",
  ]);

  await page.getByTestId("click").click();
  await expect(page.getByTestId("script")).toHaveText("clicked");
});
`;

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const code_root = path.join(repo_root, "..");
	const smokes_root = path.join(code_root, "smokes");
	const smoke_dir = path.join(smokes_root, "ser-current");
	const artifact_argument = process.argv[2];
	const corepack = yield* CommandName("corepack");

	if (!artifact_argument) {
		return yield* Effect.fail(
			new Error("Runtime smoke requires the exact runtime .tgz artifact path."),
		);
	}

	const runtime_tarball = path.resolve(process.cwd(), artifact_argument);
	const has_runtime_tarball = yield* file_system.exists(runtime_tarball);

	if (!runtime_tarball.endsWith(".tgz") || !has_runtime_tarball) {
		return yield* Effect.fail(
			new Error(`Runtime artifact must be an existing .tgz file: ${runtime_tarball}`),
		);
	}

	if (!smoke_dir.startsWith(smokes_root)) {
		return yield* Effect.fail(new Error(`Refusing to write outside smoke root: ${smoke_dir}`));
	}

	yield* RemovePath(smoke_dir);
	yield* file_system.makeDirectory(path.join(smoke_dir, "src", "lib"), { recursive: true });
	yield* file_system.makeDirectory(path.join(smoke_dir, "src", "routes"), {
		recursive: true,
	});
	yield* file_system.makeDirectory(path.join(smoke_dir, "tests"), { recursive: true });
	yield* Effect.all(
		[
			WriteJson(smoke_dir, "package.json", {
				name: "ser-current",
				private: true,
				type: "module",
				packageManager: "pnpm@11.10.0",
				scripts: {
					build: "vite build",
					preview: "node preview-supervisor.mjs",
					smoke: "playwright test",
				},
				dependencies: {
					"@playwright/test": "^1.60.0",
					"@sveltejs/adapter-node": "6.0.0-next.0",
					"@sveltejs/kit": "3.0.0-next.1",
					"@sveltejs/vite-plugin-svelte": "^7.0.0",
					effect: "^4.0.0-beta.66",
					portless: "0.12.0",
					svelte: "^5.56.0",
					typescript: "^6.0.0",
					vite: "8.1.3",
				},
				devDependencies: {
					"@types/node": "^24.0.0",
				},
			}),
			WriteText(
				smoke_dir,
				"pnpm-workspace.yaml",
				"allowBuilds:\n    msgpackr-extract: true\n",
			),
			WriteText(smoke_dir, "src/app.html", app_html),
			WriteText(smoke_dir, "src/lib/demo.remote.ts", demo_remote_ts),
			WriteText(smoke_dir, "src/routes/+layout.svelte", layout_svelte),
			WriteText(smoke_dir, "src/routes/+page.svelte", page_svelte),
			WriteText(smoke_dir, "vite.config.ts", vite_config),
			WriteText(smoke_dir, "playwright.config.ts", playwright_config),
			WriteText(smoke_dir, "preview-supervisor.mjs", preview_supervisor),
			WriteText(smoke_dir, "tests/runtime.spec.ts", runtime_spec),
		],
		{ concurrency: "unbounded" },
	);
	yield* RunCommand(corepack, ["pnpm", "install"], smoke_dir, { inherit: true });
	yield* RunCommand(corepack, ["pnpm", "add", runtime_tarball], smoke_dir, {
		inherit: true,
	});
	yield* RunCommand(corepack, ["pnpm", "run", "build"], smoke_dir, {
		inherit: true,
	});
	yield* RunCommand(corepack, ["pnpm", "exec", "playwright", "install", "chromium"], smoke_dir, {
		inherit: true,
	});
	yield* RunCommand(corepack, ["pnpm", "run", "smoke"], smoke_dir, {
		inherit: true,
	});
	yield* Console.log("[svelte-effect-runtime]", "current package smoke passed", {
		smoke_dir,
	});
});

const WriteJson = (smoke_dir: string, relative_path: string, value: unknown) =>
	WriteText(smoke_dir, relative_path, `${JSON.stringify(value, null, 2)}\n`);

const WriteText = (smoke_dir: string, relative_path: string, value: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		yield* file_system.writeFileString(path.join(smoke_dir, relative_path), value);
	});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
