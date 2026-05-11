import type { BuildVariant, VersionHarness } from "$tests/shared/versions.ts";
import { join } from "@std/path";
import {
  makeTempWorkspace,
  repoFile,
  runCommand,
  writeFixtureTree,
} from "$tests/shared/support.ts";

const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
let package_build_queue: Promise<void> = Promise.resolve();

async function with_package_build_lock<T>(work: () => Promise<T>): Promise<T> {
  const pending = package_build_queue.then(work, work);
  package_build_queue = pending.then(() => undefined, () => undefined);
  return await pending;
}

async function pack_runtime_package(): Promise<string> {
  const package_dir = repoFile("");
  const temp_dir = await makeTempWorkspace("smoke-pack-");

  await runCommand("deno", ["task", "build"], package_dir);
  const output = await runCommand(
    npm,
    ["pack", package_dir, "--json"],
    temp_dir,
  );
  const packed = JSON.parse(output.stdout) as Array<{ filename: string }>;
  const tarball = packed[0]?.filename;

  if (!tarball) {
    throw new Error("npm pack did not return a tarball filename.");
  }

  return join(temp_dir, tarball);
}

async function install_smoke_dependencies(
  fixture_root: string,
  harness: VersionHarness,
  tarball: string,
): Promise<void> {
  const effect_dependency = harness.label === "v4"
    ? "effect@beta"
    : "effect@^3.21.0";

  await runCommand(
    npm,
    [
      "install",
      "--no-package-lock",
      tarball,
      effect_dependency,
      "vite",
      "svelte",
      "@sveltejs/kit",
      "@sveltejs/adapter-static",
      "@sveltejs/vite-plugin-svelte",
    ],
    fixture_root,
  );
}

function create_plain_fixture(variant: BuildVariant): Record<string, string> {
  return {
    "index.html": `<!doctype html>
<html lang="en">
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
    "package.json": JSON.stringify(
      {
        name: `ser-plain-${variant.name}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "src/App.svelte": `<script lang="ts">
  import { ClientRuntime } from "${variant.runtimeImport}";
  import Counter from "./Counter.svelte";

  ClientRuntime.make();
</script>

<main>
  <h1>plain smoke</h1>
  <Counter />
</main>
`,
    "src/Counter.svelte": `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(42);
</script>

<p>{count}</p>
`,
    "src/main.ts": `import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
`,
    "vite.config.ts": `import { defineConfig } from "vite";
import { svelte_effect_runtime } from "${variant.viteImport}";

export default defineConfig({
  plugins: [
    svelte_effect_runtime({
      effect: {
        runtimeModuleId: ${JSON.stringify(variant.runtimeImport)},
      },
    }),
  ],
});
`,
  };
}

function create_kit_fixture(
  variant: BuildVariant,
): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: `ser-kit-${variant.name}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "src/app.html": `<!doctype html>
<html lang="en">
  <head>%sveltekit.head%</head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
    "src/routes/+layout.ts": `export const prerender = true;`,
    "src/routes/+page.svelte": `<script lang="ts" effect>
  import Counter from "./Counter.svelte";
  import {
    get_post,
    get_posts,
    get_static_post,
    square_post,
  } from "./posts.remote";

  let command_result = $state("");
  let post_title = $state("");
  let prerender_title = $state("");

  prerender_title = (yield* get_static_post("intro")).title;
</script>

<h1>kit smoke</h1>
<Counter />

<button onclick={() => command_result = String((yield* square_post(4)).value)}>
  command
</button>
<button onclick={() => post_title = (yield* get_post("alpha")).title}>
  query
</button>
<button onclick={() => post_title = (yield* get_posts("beta")).title}>
  batch
</button>

<p>{command_result}</p>
<p>{post_title}</p>
<p>{prerender_title}</p>
`,
    "src/routes/Counter.svelte": `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(1);
</script>

<p>{count}</p>
`,
    "src/routes/posts.remote.ts": `import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Command, Prerender, Query } from "${variant.runtimeImport}";

const Post_slug = Schema.String;

export const get_post = Query(Post_slug, (slug) =>
  Effect.succeed({
    slug,
    title: "Post " + slug,
  })
);

export const get_posts = Query.batch(Post_slug, (slugs) =>
  Effect.succeed(
    new Map(
      slugs.map((slug) => [slug, {
        slug,
        title: "Post " + slug,
      }]),
    ),
  )
);

export const square_post = Command(Schema.Number, (value) =>
  Effect.succeed({
    value: value * value,
  })
);

export const get_static_post = Prerender(
  Post_slug,
  (slug) =>
    Effect.succeed({
      slug,
      title: "Static " + slug,
    }),
  {
    inputs: () => ["intro"],
  },
);
`,
    "svelte.config.js": `import adapter from "@sveltejs/adapter-static";
import { effect_preprocess } from "${variant.preprocessImport}";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  preprocess: [
    effect_preprocess({
      runtimeModuleId: ${JSON.stringify(variant.runtimeImport)},
    }),
  ],
  kit: {
    adapter: adapter(),
    experimental: {
      remoteFunctions: true,
    },
  },
};

export default config;
`,
    "vite.config.mjs": `import { sveltekit } from "@sveltejs/kit/vite";
import { sveltekit_effect_runtime } from "${variant.viteImport}";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit_effect_runtime(), sveltekit()],
});
`,
  };
}

function create_kit_form_descriptor_fixture(
  variant: BuildVariant,
): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: `ser-kit-form-descriptor-${variant.name}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "src/app.html": `<!doctype html>
<html lang="en">
  <head>%sveltekit.head%</head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
    "src/routes/+layout.ts": `export const prerender = true;`,
    "src/routes/+page.server.ts":
      `import { oauth_remote } from "./oauth.remote";

export function load() {
  const native_descriptor =
    Object.getOwnPropertyDescriptor(oauth_remote, "native");
  const submit_descriptor =
    Object.getOwnPropertyDescriptor(oauth_remote, "submit");
  const method_descriptor =
    Object.getOwnPropertyDescriptor(oauth_remote, "method");
  const action_descriptor =
    Object.getOwnPropertyDescriptor(oauth_remote, "action");

  const attachment_symbols = Object.getOwnPropertySymbols(oauth_remote).filter(
    (symbol) => symbol.description === "@attach",
  );

  return {
    native: {
      configurable: native_descriptor?.configurable ?? null,
      enumerable: native_descriptor?.enumerable ?? null,
      writable: "writable" in (native_descriptor ?? {})
        ? (native_descriptor as PropertyDescriptor).writable ?? null
        : null,
    },
    submit: {
      present: submit_descriptor !== undefined,
      enumerable: submit_descriptor?.enumerable ?? null,
    },
    method: {
      enumerable: method_descriptor?.enumerable ?? null,
      value: method_descriptor?.value ?? null,
    },
    action: {
      enumerable: action_descriptor?.enumerable ?? null,
      value_starts_with_remote: typeof action_descriptor?.value === "string"
        ? action_descriptor.value.startsWith("?/remote=")
        : null,
    },
    attachment_symbol_count: attachment_symbols.length,
  };
}
`,
    "src/routes/+page.svelte": `<script lang="ts">
  let { data } = $props<{
    data: {
      native: {
        configurable: boolean | null;
        enumerable: boolean | null;
        writable: boolean | null;
      };
      submit: {
        present: boolean;
        enumerable: boolean | null;
      };
      method: {
        enumerable: boolean | null;
        value: string | null;
      };
      action: {
        enumerable: boolean | null;
        value_starts_with_remote: boolean | null;
      };
      attachment_symbol_count: number;
    };
  }>();
</script>

<h1>form descriptor smoke</h1>
<p>native: {String(data.native.configurable)} / {String(data.native.enumerable)} / {String(data.native.writable)}</p>
<p>submit: {String(data.submit.present)} / {String(data.submit.enumerable)}</p>
<p>method: {String(data.method.enumerable)} / {String(data.method.value)}</p>
<p>action: {String(data.action.enumerable)} / {String(data.action.value_starts_with_remote)}</p>
<p>attachments: {data.attachment_symbol_count}</p>
`,
    "src/routes/oauth.remote.ts": `import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Form } from "${variant.runtimeImport}";

const OAuthInput = Schema.Struct({
  provider: Schema.String,
});

export const oauth_remote = Form(OAuthInput, ({ data }) =>
  Effect.succeed({
    provider: data.provider,
    redirectTo: "/auth/" + data.provider,
  })
);
`,
    "svelte.config.js": `import adapter from "@sveltejs/adapter-static";
import { effect_preprocess } from "${variant.preprocessImport}";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  preprocess: [
    effect_preprocess({
      runtimeModuleId: ${JSON.stringify(variant.runtimeImport)},
    }),
  ],
  kit: {
    adapter: adapter(),
    experimental: {
      remoteFunctions: true,
    },
  },
};

export default config;
`,
    "vite.config.mjs": `import { sveltekit } from "@sveltejs/kit/vite";
import { sveltekit_effect_runtime } from "${variant.viteImport}";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit_effect_runtime(), sveltekit()],
});
`,
  };
}

async function build_fixture(
  fixture_root: string,
  config_file: string,
): Promise<void> {
  await runCommand(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--config",
      config_file,
    ],
    fixture_root,
  );
}

export function register_smoke_behaviors(harness: VersionHarness): void {
  for (const variant of harness.buildVariants) {
    Deno.test(
      `[${harness.label}] plain Vite fixtures build for ${variant.name}`,
      async () => {
        await with_package_build_lock(async () => {
          const fixture_root = await makeTempWorkspace(
            `plain-${variant.name}-`,
          );
          const tarball = await pack_runtime_package();
          await writeFixtureTree(fixture_root, create_plain_fixture(variant));
          await install_smoke_dependencies(fixture_root, harness, tarball);
          await build_fixture(fixture_root, "vite.config.ts");
        });
      },
    );

    Deno.test(
      `[${harness.label}] SvelteKit fixtures build for ${variant.name}`,
      async () => {
        await with_package_build_lock(async () => {
          const fixture_root = await makeTempWorkspace(`kit-${variant.name}-`);
          const tarball = await pack_runtime_package();
          await writeFixtureTree(
            fixture_root,
            create_kit_fixture(variant),
          );
          await install_smoke_dependencies(fixture_root, harness, tarball);
          await build_fixture(fixture_root, "vite.config.mjs");
        });
      },
    );

    Deno.test(
      `[${harness.label}] SvelteKit Form fixtures survive native descriptor inspection for ${variant.name}`,
      async () => {
        await with_package_build_lock(async () => {
          const fixture_root = await makeTempWorkspace(
            `kit-form-descriptor-${variant.name}-`,
          );
          const tarball = await pack_runtime_package();
          await writeFixtureTree(
            fixture_root,
            create_kit_form_descriptor_fixture(variant),
          );
          await install_smoke_dependencies(fixture_root, harness, tarball);
          await build_fixture(fixture_root, "vite.config.mjs");
        });
      },
    );
  }
}
