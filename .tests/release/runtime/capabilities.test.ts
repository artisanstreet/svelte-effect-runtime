import {
	capability_lane_ids,
	capability_lanes,
	get_capability_lane,
	static_policy_test_files,
} from "../../../build/ci/capabilities.ts";
import { relative, resolve } from "node:path";
import { readdir } from "node:fs/promises";
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
	expect(get_capability_lane("compiler").name).toBe("Capability / Compiler");
	expect(() => get_capability_lane("release")).toThrow(/unknown capability lane/i);
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
