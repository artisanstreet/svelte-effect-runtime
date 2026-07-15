import {
	plan_release_notes,
	select_previous_release_tag,
	type ReleaseCommit,
} from "../../../build/release/release-notes.ts";
import { plan_release, type PackageVersions } from "../../../build/release/policy.ts";
import { expect, test } from "vitest";

const current_versions: PackageVersions = {
	runtime: "4.1.0",
	grammars: "4.1.0",
	"language-server": "4.1.0",
	vsix: "4.1.0",
};

const plan = plan_release({
	event: "workflow_dispatch",
	ref: "refs/heads/candidate",
	commit: "abcdef0123456789",
	current_versions,
	mode: "dry-run",
	repository_state: {
		candidate_head: "abcdef0123456789",
		candidate_is_on_master: true,
		greatest_release_version: undefined,
		current_tag_exists: false,
	},
});

const commits: ReadonlyArray<ReleaseCommit> = [
	{ sha: "1111111aaaaaaaaa", subject: "feat: add artifact promotion" },
	{ sha: "2222222bbbbbbbbb", subject: "fix: preserve release identity" },
];

test("a release without a prior semantic tag produces deterministic initial notes", () => {
	const notes = plan_release_notes({
		plan,
		tags: ["latest", "release-candidate"],
		commits,
		repository_url: "https://github.com/usebarekey/svelte-effect-runtime",
	});

	expect(notes.previous_tag).toBeUndefined();
	expect(notes.range).toBe("abcdef0123456789");
	expect(notes.markdown).toBe(`## v4.1.0

Initial release.

### Commits

- [1111111](https://github.com/usebarekey/svelte-effect-runtime/commit/1111111aaaaaaaaa) feat: add artifact promotion
- [2222222](https://github.com/usebarekey/svelte-effect-runtime/commit/2222222bbbbbbbbb) fix: preserve release identity
`);
});

test("one prior semantic tag defines the exact comparison range", () => {
	const notes = plan_release_notes({
		plan,
		tags: ["v4.0.0"],
		commits,
		repository_url: "https://github.com/usebarekey/svelte-effect-runtime/",
	});

	expect(notes.previous_tag).toBe("v4.0.0");
	expect(notes.range).toBe("v4.0.0..abcdef0123456789");
	expect(notes.markdown).toContain(
		"Changes since [v4.0.0](https://github.com/usebarekey/svelte-effect-runtime/releases/tag/v4.0.0).",
	);
	expect(notes.markdown).toContain(
		"[Full diff](https://github.com/usebarekey/svelte-effect-runtime/compare/v4.0.0...v4.1.0)",
	);
});

test("the greatest valid semantic version below the plan wins regardless of tag order", () => {
	expect(
		select_previous_release_tag(plan, [
			"v3.9.9",
			"v4.0.0-beta.2",
			"not-semver",
			"vnext",
			"v4.2.0",
			"v4.0.1",
			"v4.0.0",
			"v4.0.2-01",
			"v9007199254740992.0.0",
		]),
	).toBe("v4.0.1");
});

test("semantic tag ordering follows ASCII precedence instead of the host locale", () => {
	const prerelease_plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit: "abcdef0123456789",
		current_versions: {
			runtime: "4.1.0-zz",
			grammars: "4.1.0-zz",
			"language-server": "4.1.0-zz",
			vsix: "4.1.0-zz",
		},
		mode: "dry-run",
		repository_state: {
			candidate_head: "abcdef0123456789",
			candidate_is_on_master: true,
			greatest_release_version: undefined,
			current_tag_exists: false,
		},
	});

	expect(select_previous_release_tag(prerelease_plan, ["v4.1.0-Z", "v4.1.0-a"])).toBe("v4.1.0-a");
});

test("a current-tag rerun excludes itself and produces the same notes", () => {
	const input = {
		plan,
		tags: ["v4.1.0", "v4.0.0", "v3.8.0"],
		commits,
		repository_url: "https://github.com/usebarekey/svelte-effect-runtime",
	};
	const first = plan_release_notes(input);
	const second = plan_release_notes(input);

	expect(first.previous_tag).toBe("v4.0.0");
	expect(first).toEqual(second);
});
