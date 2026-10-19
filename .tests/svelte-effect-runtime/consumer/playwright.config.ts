import {
	conformance_proxy_port,
	conformance_target_ports,
	get_conformance_browsers,
	get_conformance_run_id,
	get_conformance_server_mode,
	get_conformance_target_url,
	type ConformanceServerMode,
} from "../unit/harness/model.ts";
import {
	resolve_sveltekit_profiles,
	resolve_sveltekit_target_names,
} from "./harness/sveltekit-profiles.ts";
import { defineConfig, devices, type PlaywrightTestProject } from "@playwright/test";
import { make_evidence } from "../unit/harness/evidence.ts";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const consumer_dir = dirname(fileURLToPath(import.meta.url));
const repo_root = resolve(consumer_dir, "../../..");
const applications_root = resolve(repo_root, ".dist/conformance/applications");
const portless_cli = resolve(repo_root, "node_modules/portless/dist/cli.js");
const server_output_recorder = resolve(consumer_dir, "harness/record-server-output.ts");
const portless_state_dir = resolve(
	repo_root,
	`.dist/conformance/portless-${conformance_proxy_port}`,
);
/**
 * A portless process killed while it holds the route lock leaves the lock
 * behind, and portless treats it as stale only after outliving its own acquire
 * timeout. Back-to-back runs would then fail to register their servers, so the
 * main process clears it before any server of this run starts.
 */
if (process.env.TEST_WORKER_INDEX === undefined) {
	rmSync(resolve(portless_state_dir, "routes.lock"), { force: true, recursive: true });
}

const windows_openssl_dir = "C:\\Program Files\\Git\\usr\\bin";
const executable_path = [process.platform === "win32" && windows_openssl_dir, process.env.PATH]
	.filter(Boolean)
	.join(delimiter);
const portless_env = {
	HOST_HEADER: "x-forwarded-host",
	PATH: executable_path,
	PORTLESS_HTTPS: "1",
	PORTLESS_PORT: String(conformance_proxy_port),
	PORTLESS_STATE_DIR: portless_state_dir,
};
const lane = process.env.CONFORMANCE_LANE ?? "fast";
const server_mode = get_conformance_server_mode(process.env);
const output_root = resolve(
	repo_root,
	server_mode === "production" ? ".dist/conformance" : `.dist/conformance/${server_mode}`,
);
const target_names = resolve_sveltekit_target_names(process.env);
const [profile] = resolve_sveltekit_profiles(process.env);
const browsers = get_conformance_browsers(lane, process.platform);
const projects: PlaywrightTestProject[] = [
	{
		name: "startup",
		testMatch: "startup.spec.ts",
	},
	...browsers.map((browser_name) => ({
		name: browser_name,
		dependencies: ["startup"],
		testIgnore: "startup.spec.ts",
		use: {
			...devices[
				browser_name === "chromium"
					? "Desktop Chrome"
					: browser_name === "firefox"
						? "Desktop Firefox"
						: "Desktop Safari"
			],
		},
	})),
];

export default defineConfig({
	testDir: "scenarios",
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: {
		timeout: 15_000,
	},
	outputDir: resolve(output_root, "playwright"),
	reporter: [["list"], ["json", { outputFile: resolve(output_root, "playwright-results.json") }]],
	projects,
	use: {
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
	},
	webServer: [
		{
			name: "portless-proxy",
			command: `node "${portless_cli}" proxy start --foreground --https --port ${conformance_proxy_port} --skip-trust`,
			cwd: repo_root,
			env: portless_env,
			port: conformance_proxy_port,
			ignoreHTTPSErrors: true,
			reuseExistingServer: false,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 60_000,
		},
		...target_names.map((target) => ({
			name: target,
			command: `node "${server_output_recorder}" --evidence-dir "${resolve(repo_root, dirname(make_evidence(".dist/conformance/evidence", get_conformance_run_id(server_mode, "startup"), "server-start", target, "start", "readiness.json").path))}" -- node "${portless_cli}" --name ser-conformance-${target} --force --app-port ${conformance_target_ports[target]} -- ${make_application_server_command(server_mode, profile?.browser_server, conformance_target_ports[target])}`,
			cwd: resolve(applications_root, target),
			env: portless_env,
			url: `${get_conformance_target_url(target)}/api/context`,
			/** Portless runs the app in its own process group, so it must receive a signal it can forward. */
			gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
			reuseExistingServer: false,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 60_000,
		})),
	],
});

function make_application_server_command(
	server_mode: ConformanceServerMode,
	browser_server: "adapter" | "preview" | undefined,
	port: number,
): string {
	const vite_cli = `node "node_modules/vite/bin/vite.js"`;

	if (server_mode === "development") {
		return `${vite_cli} dev --host 127.0.0.1 --port ${port} --strictPort`;
	}

	if (browser_server === "adapter") {
		return "node build";
	}

	if (browser_server === "preview") {
		return `${vite_cli} preview --host 127.0.0.1 --port ${port} --strictPort`;
	}

	throw new Error("Browser conformance requires exactly one SvelteKit profile.");
}
