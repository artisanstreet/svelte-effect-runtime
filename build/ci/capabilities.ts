export const capability_lane_ids = [
	"compiler",
	"runtime-and-lifecycle",
	"signals-and-reactivity",
	"remote-transport",
	"public-api",
	"type-contracts",
	"package-and-tooling",
] as const;

export type CapabilityLaneId = (typeof capability_lane_ids)[number];

export type CapabilityCommand = {
	readonly args: ReadonlyArray<string>;
};

export type CapabilityLane = {
	readonly id: CapabilityLaneId;
	readonly name: string;
	readonly test_files: ReadonlyArray<string>;
	readonly commands: ReadonlyArray<CapabilityCommand>;
};

const runtime_test_root = ".tests/svelte-effect-runtime/runtime";
const vsix_test_root = ".tests/svelte-effect-runtime-vsix/runtime";

export const static_policy_test_files = Object.freeze([
	".tests/release/runtime/artifact-manifest.test.ts",
	".tests/release/runtime/artifact-smoke.test.ts",
	".tests/release/runtime/capabilities.test.ts",
	".tests/release/runtime/cli.test.ts",
	".tests/release/runtime/policy.test.ts",
	".tests/release/runtime/promotion.test.ts",
	".tests/release/runtime/registry-state.test.ts",
	".tests/release/runtime/report.test.ts",
	".tests/release/runtime/release-notes.test.ts",
	".tests/release/runtime/workflow-policy.test.ts",
]);

export const capability_lanes: ReadonlyArray<CapabilityLane> = Object.freeze([
	make_lane("compiler", "Capability / Compiler", [
		`${runtime_test_root}/detect.test.ts`,
		`${runtime_test_root}/diagnostics.test.ts`,
		`${runtime_test_root}/script-transform.test.ts`,
		`${runtime_test_root}/source-scan.test.ts`,
	]),
	make_lane("runtime-and-lifecycle", "Capability / Runtime and lifecycle", [
		`${runtime_test_root}/dispatcher.test.ts`,
		`${runtime_test_root}/generators.test.ts`,
		`${runtime_test_root}/helpers/assert.test.ts`,
		`${runtime_test_root}/server-handler.test.ts`,
	]),
	make_lane("signals-and-reactivity", "Capability / Signals and reactivity", [
		`${runtime_test_root}/markup.test.ts`,
	]),
	make_lane("remote-transport", "Capability / Remote transport", [
		`${runtime_test_root}/remote-client.test.ts`,
		`${runtime_test_root}/remote-server.test.ts`,
		`${runtime_test_root}/remote-shared.test.ts`,
		`${runtime_test_root}/sveltekit-remote-bridge.test.ts`,
	]),
	make_lane("public-api", "Capability / Public API", [
		`${runtime_test_root}/integration.test.ts`,
	]),
	make_lane(
		"type-contracts",
		"Capability / Type contracts",
		[`${runtime_test_root}/remote-client-types.test.ts`],
		[
			["pnpm", "run", "check:grammars"],
			["pnpm", "run", "check:runtime"],
			["pnpm", "run", "check:lsp"],
			["pnpm", "run", "check:vsix"],
		],
	),
	make_lane("package-and-tooling", "Capability / Package and tooling", [
		".tests/svelte-effect-runtime-grammars/runtime/grammars.test.ts",
		".tests/svelte-effect-runtime-language-server/runtime/language-server.test.ts",
		`${vsix_test_root}/vsix-client-lifecycle.test.ts`,
		`${vsix_test_root}/vsix-coordinator-lifecycle.test.ts`,
		`${vsix_test_root}/vsix-language-server-state.test.ts`,
		`${vsix_test_root}/vsix-server-install-lease.test.ts`,
		`${vsix_test_root}/vsix-server-install-retention.test.ts`,
		`${vsix_test_root}/vsix-server-install-staging.test.ts`,
		`${vsix_test_root}/vsix-server-path.test.ts`,
		`${vsix_test_root}/vsix-svelte-config.test.ts`,
		`${vsix_test_root}/vsix-svelte-extension-control.test.ts`,
	]),
]);

export function get_capability_lane(id: string): CapabilityLane {
	const lane = capability_lanes.find((candidate) => candidate.id === id);

	if (!lane) {
		throw new Error(
			`Unknown capability lane ${id}; expected ${capability_lane_ids.join(", ")}.`,
		);
	}

	return lane;
}

function make_lane(
	id: CapabilityLaneId,
	name: string,
	test_files: ReadonlyArray<string>,
	commands: ReadonlyArray<ReadonlyArray<string>> = [],
): CapabilityLane {
	return Object.freeze({
		id,
		name,
		test_files: Object.freeze([...test_files]),
		commands: Object.freeze(
			commands.map((args) => Object.freeze({ args: Object.freeze([...args]) })),
		),
	});
}
