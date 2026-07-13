import { CommandName, RepoRoot, RemovePath, RunCommand } from "./node-utils.ts";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";

const PackedTarballSchema = Schema.Struct({
	filename: Schema.optional(Schema.String),
	tarball: Schema.optional(Schema.String),
});
const PackOutputSchema = Schema.Union([PackedTarballSchema, Schema.Array(PackedTarballSchema)]);

const ResolvePackedTarball = (repo_root: string, stdout: string, package_name: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackOutputSchema))(
			stdout,
		);
		const result = Array.isArray(parsed) ? parsed[0] : parsed;
		const filename = result?.filename ?? result?.tarball;

		if (!filename) {
			return yield* Effect.fail(
				new Error(`pnpm pack did not create a ${package_name} tarball.`),
			);
		}

		if (path.isAbsolute(filename)) {
			return filename;
		}

		return path.join(repo_root, ".dist", package_name, filename);
	});

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
    create_item,
    get_message,
    get_snapshot,
  } from "$lib/demo.remote";

  let script_value = $state("pending");
  let count = $state(yield* Effect.succeed(41));
  let query_value = $state("pending");
  let command_value = $state("pending");
  let form_value = $state("pending");
  let prerender_value = $state("pending");

  script_value = yield* Effect.succeed("script effect ready");
  count = yield* Effect.succeed(count + 1);
  query_value = yield* get_message();
  command_value = yield* add_one();
  form_value = yield* create_item.submit({ title: "draft" });
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
  <p data-testid="form">{form_value}</p>
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
  Form,
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

export const create_item = Form("unchecked", ({ data }) =>
  Effect.succeed(\`form ready \${data.title}\`)
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
    command: "corepack pnpm run preview",
    url: "https://ser-current-smoke.localhost",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: "https://ser-current-smoke.localhost",
    ignoreHTTPSErrors: true,
  },
});
`;

const runtime_spec = `import { expect, test } from "@playwright/test";

test("current package drives script and markup effects", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("script")).toHaveText("script effect ready");
  await expect(page.getByTestId("count")).toHaveText("42");
  await expect(page.getByTestId("query")).toHaveText("query ready");
  await expect(page.getByTestId("command")).toHaveText("command ready 1");
  await expect(page.getByTestId("form")).toHaveText("form ready draft");
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
	const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime");
	const corepack = yield* CommandName("corepack");

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
					preview:
						"corepack pnpm dlx portless@0.12.0 ser-current-smoke vp exec vite preview",
					smoke: "playwright test",
				},
				dependencies: {
					"@playwright/test": "^1.60.0",
					"@sveltejs/adapter-node": "6.0.0-next.0",
					"@sveltejs/kit": "3.0.0-next.1",
					"@sveltejs/vite-plugin-svelte": "^7.0.0",
					effect: "^4.0.0-beta.66",
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
			WriteText(smoke_dir, "tests/runtime.spec.ts", runtime_spec),
		],
		{ concurrency: "unbounded" },
	);
	yield* RunCommand(corepack, ["pnpm", "install"], smoke_dir, { inherit: true });
	yield* RunCommand(corepack, ["pnpm", "run", "build"], package_dir, {
		inherit: true,
	});

	const runtime_pack = yield* RunCommand(
		"vp",
		["node", "build/pack.ts", "svelte-effect-runtime"],
		repo_root,
	);
	const runtime_tarball = yield* ResolvePackedTarball(
		repo_root,
		runtime_pack.stdout,
		"svelte-effect-runtime",
	);

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
