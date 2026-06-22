import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const code_root = resolve(repo_root, "..");
const smokes_root = join(code_root, "smokes");
const smoke_dir = join(smokes_root, "ser-current");
const package_dir = join(repo_root, "modules", "svelte-effect-runtime");
const deno = Deno.execPath();
const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const npx = Deno.build.os === "windows" ? "npx.cmd" : "npx";

async function write_json(
  path: string,
  value: unknown,
): Promise<void> {
  await write_text(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function write_text(path: string, value: string): Promise<void> {
  await Deno.writeTextFile(join(smoke_dir, path), value);
}

async function run_command(
  command: string,
  args: Array<string>,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  if (!output.success) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n\n"),
    );
  }

  return { stdout, stderr };
}

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

const vite_config = `import { effect } from "svelte-effect-runtime";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import adapter from "@sveltejs/adapter-node";

export default defineConfig({
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
    command: "npm run preview -- --port 49621 --strictPort",
    port: 49621,
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:49621",
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

await main();

async function main(): Promise<void> {
  if (!smoke_dir.startsWith(smokes_root)) {
    throw new Error(`Refusing to write outside smoke root: ${smoke_dir}`);
  }

  await Deno.remove(smoke_dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(join(smoke_dir, "src", "lib"), { recursive: true });
  await Deno.mkdir(join(smoke_dir, "src", "routes"), { recursive: true });
  await Deno.mkdir(join(smoke_dir, "tests"), { recursive: true });

  await write_json("package.json", {
    name: "ser-current",
    private: true,
    type: "module",
    scripts: {
      build: "vite build",
      preview: "vite preview --host 127.0.0.1",
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
      vite: "^8.0.0",
    },
    devDependencies: {},
  });

  await write_text("src/app.html", app_html);
  await write_text("src/lib/demo.remote.ts", demo_remote_ts);
  await write_text("src/routes/+layout.svelte", layout_svelte);
  await write_text("src/routes/+page.svelte", page_svelte);
  await write_text("vite.config.ts", vite_config);
  await write_text("playwright.config.ts", playwright_config);
  await write_text("tests/runtime.spec.ts", runtime_spec);

  await run_command(npm, ["install", "--legacy-peer-deps"], smoke_dir);
  await run_command(deno, ["task", "build"], package_dir);
  await run_command(npm, ["pack", package_dir, "--json"], smoke_dir);

  const tarballs = [];

  for await (const entry of Deno.readDir(smoke_dir)) {
    if (entry.isFile && entry.name.endsWith(".tgz")) {
      tarballs.push(entry.name);
    }
  }

  const tarball = tarballs.find((name) =>
    name.startsWith("svelte-effect-runtime-")
  );

  if (!tarball) {
    throw new Error("npm pack did not create a svelte-effect-runtime tarball.");
  }

  await run_command(
    npm,
    ["install", "--legacy-peer-deps", join(smoke_dir, tarball)],
    smoke_dir,
  );
  await run_command(npm, ["run", "build"], smoke_dir);
  await run_command(npx, ["playwright", "install", "chromium"], smoke_dir);
  await run_command(npm, ["run", "smoke"], smoke_dir);

  console.log("[svelte-effect-runtime]", "current package smoke passed", {
    smoke_dir,
  });
}
