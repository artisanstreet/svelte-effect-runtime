import {
	expected_artifact_name,
	parse_release_channel,
	plan_release,
	release_channels,
	release_package_definitions,
	type PackageVersions,
	type ReleaseRepositoryState,
} from "../../../build/release/policy.ts";
import { expect, test } from "vitest";

const commit = "abcdef0123456789abcdef0123456789abcdef01";
const current_versions: PackageVersions = {
	runtime: "4.1.0",
	grammars: "4.1.0",
	"language-server": "4.1.0",
	vsix: "4.1.0",
};
const candidate_state: ReleaseRepositoryState = {
	candidate_head: commit,
	candidate_is_on_master: true,
	greatest_release_version: "4.0.0",
	current_tag_exists: false,
};

test("release channels and artifacts are a closed supported set", () => {
	expect(release_channels).toEqual(["npm", "openvsx", "github-release"]);
	expect(parse_release_channel("npm")).toBe("npm");
	expect(() => parse_release_channel("marketplace")).toThrow();
	expect(() => parse_release_channel("jsr")).toThrow();
	expect(
		release_package_definitions.map((definition) =>
			expected_artifact_name(definition, "4.1.0"),
		),
	).toEqual([
		"svelte-effect-runtime-4.1.0.tgz",
		"svelte-effect-runtime-grammars-4.1.0.tgz",
		"svelte-effect-runtime-language-server-4.1.0.tgz",
		"svelte-effect-runtime-vscode-4.1.0.vsix",
	]);
});

test("pull requests and pushes always verify without release history", () => {
	const pull_request = plan_release({
		event: "pull_request",
		ref: "refs/pull/29/merge",
		commit,
		current_versions,
	});
	const master_push = plan_release({
		event: "push",
		ref: "refs/heads/master",
		commit,
		current_versions,
	});

	expect(pull_request).toMatchObject({
		intent: "verify",
		publish: false,
		dry_run: false,
		version_changed: false,
	});
	expect(master_push).toMatchObject({
		intent: "verify",
		publish: false,
		dry_run: false,
		version_changed: false,
	});
});

test("candidate dispatch requires an explicit mode and verified branch ancestry", () => {
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			repository_state: candidate_state,
		}),
	).toThrow(/explicit release mode/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/master",
			commit,
			current_versions,
			mode: "release",
			repository_state: candidate_state,
		}),
	).toThrow(/only allowed from refs\/heads\/candidate/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "release",
			repository_state: { ...candidate_state, candidate_head: "0".repeat(40) },
		}),
	).toThrow(/does not match candidate head/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "release",
			repository_state: { ...candidate_state, candidate_is_on_master: false },
		}),
	).toThrow(/must be reachable from master/i);
});

test("candidate release publishes only a synchronized version newer than every release tag", () => {
	const plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit,
		current_versions,
		mode: "release",
		repository_state: candidate_state,
	});

	expect(plan).toMatchObject({
		mode: "release",
		version: "4.1.0",
		previous_version: "4.0.0",
		intent: "publish",
		publish: true,
		dry_run: false,
		version_changed: true,
	});
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "release",
			repository_state: {
				...candidate_state,
				greatest_release_version: "4.1.0",
			},
		}),
	).toThrow(/must be greater than greatest release version/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "release",
			repository_state: { ...candidate_state, current_tag_exists: true },
		}),
	).toThrow(/already exists.*resume/i);
});

test("candidate dry runs enforce release eligibility without publication", () => {
	const plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit,
		current_versions,
		mode: "dry-run",
		repository_state: candidate_state,
	});

	expect(plan).toMatchObject({
		mode: "dry-run",
		intent: "verify",
		publish: false,
		dry_run: true,
		version_changed: true,
	});
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "dry-run",
			repository_state: {
				...candidate_state,
				greatest_release_version: "4.2.0",
			},
		}),
	).toThrow(/must be greater than greatest release version/i);
});

test("resume requires the exact candidate version and commit", () => {
	const resume_plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit,
		current_versions,
		mode: "resume",
		repository_state: {
			...candidate_state,
			greatest_release_version: "4.1.0",
			current_tag_exists: true,
		},
		resume: { version: "4.1.0", commit },
	});

	expect(resume_plan).toMatchObject({
		mode: "resume",
		intent: "resume",
		publish: true,
		dry_run: false,
		version_changed: false,
	});
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "resume",
			repository_state: candidate_state,
		}),
	).toThrow(/resume requires an exact version and commit/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "resume",
			repository_state: candidate_state,
			resume: { version: "4.0.0", commit },
		}),
	).toThrow(/does not match current version/i);
});

test("non-dispatch events reject release mode and resume claims", () => {
	expect(() =>
		plan_release({
			event: "push",
			ref: "refs/heads/master",
			commit,
			current_versions,
			mode: "release",
			repository_state: candidate_state,
		}),
	).toThrow(/only workflow_dispatch may specify/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions,
			mode: "release",
			repository_state: candidate_state,
			resume: { version: "4.1.0", commit },
		}),
	).toThrow(/resume values require resume mode/i);
});

test("unsynchronized or invalid current versions fail before planning", () => {
	expect(() =>
		plan_release({
			event: "push",
			ref: "refs/heads/master",
			commit,
			current_versions: { ...current_versions, vsix: "4.1.1" },
		}),
	).toThrow(/current package versions are not synchronized/i);
	expect(() =>
		plan_release({
			event: "pull_request",
			ref: "refs/pull/29/merge",
			commit,
			current_versions: { ...current_versions, runtime: "next" },
		}),
	).toThrow(/invalid semantic version/i);
});

test("release plans and canonical package definitions are deeply immutable", () => {
	const plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit,
		current_versions,
		mode: "release",
		repository_state: candidate_state,
	});

	expect(Object.isFrozen(release_channels)).toBe(true);
	expect(Object.isFrozen(release_package_definitions)).toBe(true);
	expect(release_package_definitions.every(Object.isFrozen)).toBe(true);
	expect(Object.isFrozen(plan)).toBe(true);
	expect(Object.isFrozen(plan.channels)).toBe(true);
	expect(Object.isFrozen(plan.packages)).toBe(true);
	expect(plan.packages.every(Object.isFrozen)).toBe(true);
});
