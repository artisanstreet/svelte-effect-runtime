import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const docs_dir = join(repo_root, "modules", "docs");
const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";

await main();

async function main(): Promise<void> {
  const port = get_available_port();
  const base_url = `http://localhost:${port}`;

  await run_command(npm, ["run", "build"], docs_dir);

  const server = new Deno.Command("node", {
    args: ["node_modules/next/dist/bin/next", "start", "--port", String(port)],
    cwd: docs_dir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    await wait_for_docs(base_url);
    await assert_root_route(base_url);
    await assert_docs_css(base_url);
    await assert_code_blocks(base_url);
  } finally {
    server.kill("SIGTERM");
    await server.status.catch(() => undefined);
  }

  console.log("[svelte-effect-runtime]", "docs smoke passed", {
    url: `${base_url}/docs`,
  });
}

function get_available_port(): number {
  const listener = Deno.listen({
    hostname: "127.0.0.1",
    port: 0,
  });
  const port = (listener.addr as Deno.NetAddr).port;

  listener.close();

  return port;
}

async function run_command(
  command: string,
  args: Array<string>,
  cwd: string,
): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (output.success) {
    return;
  }

  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  throw new Error(
    [
      `${command} ${args.join(" ")} failed`,
      stdout.trim(),
      stderr.trim(),
    ].filter(Boolean).join("\n\n"),
  );
}

async function wait_for_docs(base_url: string): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${base_url}/docs`).catch(() => undefined);

    if (response?.ok) {
      return;
    }

    await new Promise((resolve_delay) => setTimeout(resolve_delay, 250));
  }

  throw new Error("Docs preview server did not become ready.");
}

async function assert_root_route(base_url: string): Promise<void> {
  const response = await fetch(base_url, { redirect: "manual" });

  if (response.status !== 307 && response.status !== 308) {
    throw new Error(`Expected root to redirect to /docs, got ${response.status}.`);
  }

  const location = response.headers.get("location");

  if (location !== "/docs") {
    throw new Error(`Expected root redirect location /docs, got ${location}.`);
  }
}

async function assert_docs_css(base_url: string): Promise<void> {
  const response = await fetch(`${base_url}/docs`);
  const html = await response.text();
  const css_paths = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)]
    .map((match) => match[1]);

  if (css_paths.length === 0) {
    throw new Error("Docs page did not include a CSS asset.");
  }

  const stylesheets = await Promise.all(
    css_paths.map(async (path) => {
      const url = new URL(path, base_url);
      const css_response = await fetch(url);

      if (!css_response.ok) {
        throw new Error(`CSS asset failed to load: ${url.href}`);
      }

      return await css_response.text();
    }),
  );

  const css = stylesheets.join("\n");

  if (
    !css.includes(".flex") ||
    !css.includes(".min-h-screen") ||
    !css.includes(".bg-fd-background")
  ) {
    throw new Error("Docs CSS does not include Fumadocs layout styles.");
  }
}

async function assert_code_blocks(base_url: string): Promise<void> {
  const response = await fetch(`${base_url}/docs/remote-functions/query`);
  const html = await response.text();

  if (html.includes("code-group")) {
    throw new Error("Docs page rendered a raw code-group directive.");
  }

  if (!html.includes("<figure") || !html.includes('role="region"')) {
    throw new Error("Docs page did not render Fumadocs code blocks.");
  }
}
