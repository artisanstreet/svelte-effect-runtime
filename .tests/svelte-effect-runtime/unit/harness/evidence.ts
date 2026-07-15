import type { Evidence, HarnessPhase, TargetName } from "./model.ts";

export function make_evidence(
	root: string,
	run_id: string,
	scenario_id: string,
	target: TargetName,
	phase: HarnessPhase,
	filename: string,
	metadata: Readonly<Record<string, string>> = {},
): Evidence {
	const segments = [run_id, scenario_id, target, phase, filename].map(safe_segment);
	const path = [root.replaceAll("\\", "/").replace(/\/$/, ""), ...segments].join("/");

	return {
		scenario_id,
		target,
		phase,
		path,
		metadata,
	};
}

function safe_segment(value: string): string {
	const segment = value.trim().replaceAll(/[^a-zA-Z0-9._-]+/g, "-");

	if (!segment || segment === "." || segment === "..") {
		throw new Error(`Invalid evidence path segment: ${value}`);
	}

	return segment;
}
