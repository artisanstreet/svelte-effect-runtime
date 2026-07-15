import {
	conformance_proxy_port,
	conformance_target_ports,
	get_conformance_browsers,
	get_conformance_target_url,
} from "../unit/harness/model.ts";
import { defineConfig, devices, type PlaywrightTestProject } from "@playwright/test";
import { make_evidence } from "../unit/harness/evidence.ts";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const consumer_dir = dirname(fileURLToPath(import.meta.url));
const repo_root = resolve(consumer_dir, "../../..");
const applications_root = resolve(repo_root, ".dist/conformance/applications");
const portless_cli = resolve(repo_root, "node_modules/portless/dist/cli.js");
const server_output_recorder = resolve(consumer_dir, "harness/record-server-output.ts");
const portless_state_dir = resolve(repo_root, ".dist/conformance/portless");
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
const target_names = ["native", "stable", "candidate"] as const;
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
	outputDir: resolve(repo_root, ".dist/conformance/playwright"),
	reporter: [
		["list"],
		["json", { outputFile: resolve(repo_root, ".dist/conformance/playwright-results.json") }],
	],
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
			command: `node "${server_output_recorder}" --evidence-dir "${resolve(repo_root, dirname(make_evidence(".dist/conformance/evidence", "playwright-startup", "server-start", target, "start", "readiness.json").path))}" -- node "${portless_cli}" --name ser-conformance-${target} --force --app-port ${conformance_target_ports[target]} -- node build`,
			cwd: resolve(applications_root, target),
			env: portless_env,
			url: `${get_conformance_target_url(target)}/api/context`,
			reuseExistingServer: false,
			stdout: "pipe",
			stderr: "pipe",
			timeout: 60_000,
		})),
	],
});
