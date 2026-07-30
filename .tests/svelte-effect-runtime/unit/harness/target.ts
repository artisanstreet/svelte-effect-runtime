import type { Target, TargetName, TargetSource } from "./model.ts";

export function make_targets(
	stable_source: string,
	candidate_source: string,
): ReadonlyArray<Target> {
	const targets: ReadonlyArray<Target> = [
		{
			name: "native",
			source: { _tag: "Native" },
			fixture: "native",
		},
		{
			name: "stable",
			source: parse_target_source(stable_source),
			fixture: "candidate",
		},
		{
			name: "candidate",
			source: parse_target_source(candidate_source),
			fixture: "candidate",
		},
	];

	return targets;
}

export function make_candidate_artifact_source(version: string): string {
	return `artifact:.dist/svelte-effect-runtime/svelte-effect-runtime-${version}.tgz`;
}

export function parse_target_source(value: string): TargetSource {
	if (value === "native") {
		return { _tag: "Native" };
	}

	const separator = value.indexOf(":");
	const kind = separator === -1 ? "" : value.slice(0, separator);
	const payload = separator === -1 ? "" : value.slice(separator + 1).trim();

	if (!payload) {
		throw new Error(`Invalid target source: ${value}`);
	}

	if (kind === "package") {
		return { _tag: "Package", specifier: payload };
	}

	if (kind === "artifact") {
		return { _tag: "Artifact", path: payload };
	}

	if (kind === "git") {
		return { _tag: "Git", reference: payload };
	}

	throw new Error(
		`Unsupported target source ${value}; expected native, package:<specifier>, artifact:<path>, or git:<ref>.`,
	);
}

export function get_target(targets: ReadonlyArray<Target>, name: TargetName): Target {
	const target = targets.find((candidate) => candidate.name === name);

	if (!target) {
		throw new Error(`Missing ${name} target.`);
	}

	return target;
}
