import { type ReleasePlan } from "./policy.ts";

export type ReleaseCommit = {
	sha: string;
	subject: string;
};

export type PlanReleaseNotesInput = {
	plan: ReleasePlan;
	tags: ReadonlyArray<string>;
	commits: ReadonlyArray<ReleaseCommit>;
	repository_url: string;
};

export type ReleaseNotesPlan = {
	previous_tag: string | undefined;
	range: string;
	markdown: string;
};

type SemanticVersion = {
	major: number;
	minor: number;
	patch: number;
	prerelease: ReadonlyArray<string>;
};

const semantic_version_pattern =
	/^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function select_previous_release_tag(
	plan: ReleasePlan,
	tags: ReadonlyArray<string>,
): string | undefined {
	const current = parse_semantic_version(plan.version);
	const candidates = tags
		.map((tag) => ({ tag, version: parse_release_tag(tag) }))
		.filter(
			(candidate): candidate is { tag: string; version: SemanticVersion } =>
				candidate.version !== undefined &&
				compare_semantic_versions(candidate.version, current) < 0,
		)
		.sort((left, right) => compare_semantic_versions(right.version, left.version));

	return candidates[0]?.tag;
}

export function plan_release_notes(input: PlanReleaseNotesInput): ReleaseNotesPlan {
	const { plan, tags, commits } = input;
	const repository_url = input.repository_url.replace(/\/+$/, "");
	const previous_tag = select_previous_release_tag(plan, tags);
	const range = previous_tag ? `${previous_tag}..${plan.commit}` : plan.commit;
	const introduction = previous_tag
		? [
				`Changes since [${previous_tag}](${repository_url}/releases/tag/${previous_tag}).`,
				"",
				`[Full diff](${repository_url}/compare/${previous_tag}...${plan.tag})`,
			]
		: ["Initial release."];
	const commit_lines = commits.map(
		(commit) =>
			`- [${commit.sha.slice(0, 7)}](${repository_url}/commit/${commit.sha}) ${commit.subject}`,
	);
	const markdown = [
		`## ${plan.tag}`,
		"",
		...introduction,
		"",
		"### Commits",
		"",
		...commit_lines,
		"",
	].join("\n");

	return { previous_tag, range, markdown };
}

function parse_release_tag(tag: string): SemanticVersion | undefined {
	if (!tag.startsWith("v")) {
		return undefined;
	}

	return try_parse_semantic_version(tag);
}

function parse_semantic_version(value: string): SemanticVersion {
	const version = try_parse_semantic_version(value);

	if (!version) {
		throw new Error(`Invalid semantic version: ${value}.`);
	}

	return version;
}

function try_parse_semantic_version(value: string): SemanticVersion | undefined {
	const match = semantic_version_pattern.exec(value);

	if (!match) {
		return undefined;
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split(".") ?? [],
	};
}

function compare_semantic_versions(left: SemanticVersion, right: SemanticVersion): number {
	const numeric_difference =
		left.major - right.major || left.minor - right.minor || left.patch - right.patch;

	if (numeric_difference !== 0) {
		return numeric_difference;
	}

	if (left.prerelease.length === 0 || right.prerelease.length === 0) {
		return left.prerelease.length === right.prerelease.length
			? 0
			: left.prerelease.length === 0
				? 1
				: -1;
	}

	const comparison_length = Math.max(left.prerelease.length, right.prerelease.length);

	for (let index = 0; index < comparison_length; index += 1) {
		const difference = compare_prerelease_identifier(
			left.prerelease[index],
			right.prerelease[index],
		);

		if (difference !== 0) {
			return difference;
		}
	}

	return 0;
}

function compare_prerelease_identifier(
	left: string | undefined,
	right: string | undefined,
): number {
	if (left === undefined || right === undefined) {
		return left === right ? 0 : left === undefined ? -1 : 1;
	}

	const left_is_numeric = /^\d+$/.test(left);
	const right_is_numeric = /^\d+$/.test(right);

	if (left_is_numeric && right_is_numeric) {
		return Number(left) - Number(right);
	}

	if (left_is_numeric !== right_is_numeric) {
		return left_is_numeric ? -1 : 1;
	}

	return left.localeCompare(right);
}
