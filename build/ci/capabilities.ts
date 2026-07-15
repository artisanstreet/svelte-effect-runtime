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
	readonly test_command: CapabilityCommand;
	readonly commands: ReadonlyArray<CapabilityCommand>;
};

const ser_test_root = ".tests/svelte-effect-runtime";
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
		`${ser_test_root}/compiler/detect.test.ts`,
		`${ser_test_root}/compiler/diagnostic-contract.test.ts`,
		`${ser_test_root}/compiler/diagnostics.test.ts`,
		`${ser_test_root}/compiler/markup.test.ts`,
		`${ser_test_root}/compiler/representative-golden.test.ts`,
		`${ser_test_root}/compiler/script-transform.test.ts`,
		`${ser_test_root}/compiler/source-scan.test.ts`,
		`${ser_test_root}/compiler/sveltekit-remote-bridge.test.ts`,
	]),
	make_lane("runtime-and-lifecycle", "Capability / Runtime and lifecycle", [
		`${ser_test_root}/runtime/dispatcher-ownership.test.ts`,
		`${ser_test_root}/runtime/dispatcher.test.ts`,
		`${ser_test_root}/runtime/effect-channels.test.ts`,
		`${ser_test_root}/runtime/form-invalid.test.ts`,
		`${ser_test_root}/runtime/layer-lifecycle.test.ts`,
		`${ser_test_root}/runtime/server-handler.test.ts`,
		`${ser_test_root}/runtime/yieldable-normalization.test.ts`,
	]),
	make_lane(
		"signals-and-reactivity",
		"Capability / Signals and reactivity",
		[`${ser_test_root}/signals/signals.browser.test.ts`],
		[],
		["pnpm", "run", "test:conformance:signals"],
	),
	make_lane(
		"remote-transport",
		"Capability / Remote transport",
		[
			`${ser_test_root}/transport/remote-client.test.ts`,
			`${ser_test_root}/transport/remote-server.test.ts`,
			`${ser_test_root}/transport/remote-shared.test.ts`,
			`${ser_test_root}/unit/live-state.test.ts`,
		],
		[["pnpm", "run", "test:conformance:consumer"]],
	),
	make_lane("public-api", "Capability / Public API", [
		`${ser_test_root}/public-api/package.test.ts`,
		`${ser_test_root}/runtime/integration.test.ts`,
	]),
	make_lane(
		"type-contracts",
		"Capability / Type contracts",
		[`${ser_test_root}/types/packed-types.test.ts`],
		[
			["pnpm", "run", "check:grammars"],
			["pnpm", "run", "check:runtime"],
			["pnpm", "run", "check:lsp"],
			["pnpm", "run", "check:vsix"],
		],
	),
	make_lane("package-and-tooling", "Capability / Package and tooling", [
		`${ser_test_root}/tooling/packed-consumer.test.ts`,
		`${ser_test_root}/tooling/sveltekit-matrix.test.ts`,
		`${ser_test_root}/unit/artifact-manifest.test.ts`,
		`${ser_test_root}/unit/harness.test.ts`,
		`${ser_test_root}/unit/packed-artifact.test.ts`,
		`${ser_test_root}/unit/server-output.test.ts`,
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
	test_command: ReadonlyArray<string> = ["pnpm", "exec", "vp", "test", "run", ...test_files],
): CapabilityLane {
	return Object.freeze({
		id,
		name,
		test_files: Object.freeze([...test_files]),
		test_command: Object.freeze({ args: Object.freeze([...test_command]) }),
		commands: Object.freeze(
			commands.map((args) => Object.freeze({ args: Object.freeze([...args]) })),
		),
	});
}
