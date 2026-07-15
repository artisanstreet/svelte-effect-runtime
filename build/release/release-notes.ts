import { compare_semantic_versions, parse_release_tag } from "./semantic-version.ts";
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

export function select_previous_release_tag(
	plan: ReleasePlan,
	tags: ReadonlyArray<string>,
): string | undefined {
	const candidates = tags
		.map((tag) => ({ tag, version: parse_release_tag(tag) }))
		.filter(
			(candidate): candidate is { tag: string; version: string } =>
				candidate.version !== undefined &&
				compare_semantic_versions(candidate.version, plan.version) < 0,
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
