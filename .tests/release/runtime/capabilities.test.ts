import {
	capability_lane_ids,
	capability_lanes,
	get_capability_lane,
	static_policy_test_files,
} from "../../../build/ci/capabilities.ts";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { expect, test } from "vitest";

const expected_lane_names = [
	"Capability / Compiler",
	"Capability / Runtime and lifecycle",
	"Capability / Signals and reactivity",
	"Capability / Remote transport",
	"Capability / Public API",
	"Capability / Type contracts",
	"Capability / Package and tooling",
];

test("issue 28 capability lanes have stable names and testable commands", () => {
	expect(capability_lanes.map((lane) => lane.id)).toEqual(capability_lane_ids);
	expect(capability_lanes.map((lane) => lane.name)).toEqual(expected_lane_names);
	expect(capability_lanes.every((lane) => lane.test_files.length > 0)).toBe(true);
	expect(capability_lanes.every((lane) => lane.test_command.args.length > 0)).toBe(true);
	expect(get_capability_lane("compiler").name).toBe("Capability / Compiler");
	expect(get_capability_lane("signals-and-reactivity").test_command.args).toEqual([
		"pnpm",
		"run",
		"test:conformance:signals",
	]);
	expect(get_capability_lane("remote-transport").commands).toContainEqual({
		args: ["pnpm", "run", "test:conformance:consumer"],
	});
	expect(get_capability_lane("remote-transport").commands).toContainEqual({
		args: ["pnpm", "run", "test:conformance:minimum-kit"],
	});
	expect(() => get_capability_lane("release")).toThrow(/unknown capability lane/i);
});

test("signals capability installs a coherent browser test toolchain", async () => {
	const manifest_path = resolve(process.cwd(), "package.json");
	const manifest = JSON.parse(await readFile(manifest_path, "utf8")) as {
		scripts: Record<string, string>;
		devDependencies: Record<string, string>;
	};
	const script = manifest.scripts["test:conformance:signals"] ?? "";
	const browser_version = manifest.devDependencies["@vitest/browser-playwright"];
	const vitest_version = manifest.devDependencies.vitest;

	expect(script).toContain("corepack pnpm exec playwright install chromium");
	expect(script).toContain("corepack pnpm exec vitest run");
	expect(script.indexOf("playwright install chromium")).toBeLessThan(
		script.indexOf("vitest run"),
	);
	expect(vitest_version).toBe(browser_version);
	expect(vitest_version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("every current test belongs to exactly one capability or static policy group", async () => {
	const test_root = resolve(process.cwd(), ".tests");
	const discovered = (await find_test_files(test_root))
		.map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
		.sort();
	const assigned = [
		...static_policy_test_files,
		...capability_lanes.flatMap((lane) => lane.test_files),
	].sort();
	const duplicates = assigned.filter((path, index) => assigned.indexOf(path) !== index);

	expect(duplicates).toEqual([]);
	expect(assigned).toEqual(discovered);
});

async function find_test_files(root: string): Promise<ReadonlyArray<string>> {
	const entries = await readdir(root, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = resolve(root, entry.name);

			if (entry.isDirectory()) {
				return find_test_files(path);
			}

			return Promise.resolve(entry.name.endsWith(".test.ts") ? [path] : []);
		}),
	);

	return nested.flat();
}
