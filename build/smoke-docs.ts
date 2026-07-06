import { spawn } from "node:child_process";
import { command_name, get_available_port, join, repo_root, run_command } from "./node-utils.ts";

type DocsContext = {
	port: number;
	base_url: string;
};

const docs_dir = join(repo_root, "modules", "docs");
const corepack = command_name("corepack");

await run_command(corepack, ["pnpm", "run", "build"], docs_dir, {
	inherit: true,
});

const context: DocsContext = {
	port: await get_available_port(),
	base_url: "",
};

context.base_url = `http://localhost:${context.port}`;

await smoke_docs(context);

console.log("[svelte-effect-runtime]", "docs smoke passed", {
	url: `${context.base_url}/docs`,
});

async function smoke_docs(context: DocsContext): Promise<void> {
	const server = spawn(
		"node",
		["node_modules/next/dist/bin/next", "start", "--port", String(context.port)],
		{
			cwd: docs_dir,
			stdio: "ignore",
		},
	);

	try {
		await wait_for_docs(context.base_url);
		await assert_root_route(context.base_url);
		await assert_docs_css(context.base_url);
		await assert_code_blocks(context.base_url);
	} finally {
		server.kill("SIGTERM");
		await new Promise((resolve_status) => server.once("close", resolve_status));
	}
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
	const css_paths = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((match) => match[1]);

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

	if (html.includes("code-group") || html.includes(":::")) {
		throw new Error("Docs page rendered raw directive syntax.");
	}

	if (!html.includes("<figure") || !html.includes('role="region"')) {
		throw new Error("Docs page did not render Fumadocs code blocks.");
	}
}
