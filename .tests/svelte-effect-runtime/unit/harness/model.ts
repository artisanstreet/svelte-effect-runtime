export const capability_names = [
	"public-api",
	"compiler",
	"runtime",
	"signals",
	"transport",
	"consumer",
	"types",
	"tooling",
	"unit",
] as const;

export const conformance_proxy_port = 41_730;

export const conformance_proxy_protocol = "https";

export type ConformanceBrowser = "chromium" | "firefox" | "webkit";

export function get_conformance_browsers(
	lane: string,
	platform: NodeJS.Platform,
): ReadonlyArray<ConformanceBrowser> {
	if (lane !== "broad") {
		return ["chromium"];
	}

	return platform === "win32" ? ["chromium", "webkit"] : ["chromium", "firefox", "webkit"];
}

export type Capability = (typeof capability_names)[number];

export type TargetName = "native" | "stable" | "candidate";

export const conformance_target_ports = {
	native: 41_801,
	stable: 41_802,
	candidate: 41_803,
} as const satisfies Readonly<Record<TargetName, number>>;

export function get_conformance_proxy_url(target: TargetName): string {
	return `${conformance_proxy_protocol}://ser-conformance-${target}.localhost:${conformance_proxy_port}`;
}

export function get_conformance_target_url(target: TargetName): string {
	return `http://127.0.0.1:${conformance_target_ports[target]}`;
}

export type TargetSource =
	| { readonly _tag: "Native" }
	| { readonly _tag: "Package"; readonly specifier: string }
	| { readonly _tag: "Artifact"; readonly path: string }
	| { readonly _tag: "Git"; readonly reference: string };

export type Target = {
	readonly name: TargetName;
	readonly source: TargetSource;
	readonly fixture: "native" | "stable" | "candidate";
};

export type Scenario<Driver, Value> = {
	readonly id: string;
	readonly capability: Capability;
	readonly promise: string;
	readonly regression: string;
	readonly drive: (driver: Driver) => Promise<Value>;
};

export type Observation<Value = unknown> = {
	readonly scenario_id: string;
	readonly target: TargetName;
	readonly value: Value;
	readonly recorded_at: string;
};

export type Evidence = {
	readonly scenario_id: string;
	readonly target: TargetName;
	readonly phase: HarnessPhase;
	readonly path: string;
	readonly metadata: Readonly<Record<string, string>>;
};

export type Comparison = {
	readonly scenario_id: string;
	readonly oracle: TargetName;
	readonly subject: TargetName;
	readonly matches: boolean;
	readonly differences: ReadonlyArray<Difference>;
};

export type Difference = {
	readonly path: string;
	readonly oracle: unknown;
	readonly subject: unknown;
};

export const harness_phases = [
	"artifact",
	"artifact-clone",
	"artifact-checkout",
	"artifact-install",
	"artifact-build",
	"artifact-pack",
	"install",
	"sync",
	"check",
	"types",
	"build",
	"start",
	"drive",
	"compare",
] as const;

export type HarnessPhase = (typeof harness_phases)[number];
