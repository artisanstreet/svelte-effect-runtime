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

export type Capability = (typeof capability_names)[number];

export type TargetName = "native" | "stable" | "candidate";

export type TargetSource =
	| { readonly _tag: "Native" }
	| { readonly _tag: "Package"; readonly specifier: string }
	| { readonly _tag: "Artifact"; readonly path: string }
	| { readonly _tag: "Git"; readonly reference: string };

export type Target = {
	readonly name: TargetName;
	readonly source: TargetSource;
	readonly fixture: "native" | "ser";
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
