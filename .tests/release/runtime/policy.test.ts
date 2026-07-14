import {
	expected_artifact_name,
	parse_release_channel,
	plan_release,
	release_channels,
	release_package_definitions,
	type PackageVersions,
} from "../../../build/release/policy.ts";
import { expect, test } from "vitest";

const current_versions: PackageVersions = {
	runtime: "4.1.0",
	grammars: "4.1.0",
	"language-server": "4.1.0",
	vsix: "4.1.0",
};

const previous_versions: PackageVersions = {
	runtime: "4.0.0",
	grammars: "4.0.0",
	"language-server": "4.0.0",
	vsix: "4.0.0",
};

test("release channels are a closed supported set", () => {
	expect(release_channels).toEqual(["npm", "openvsx", "github-release"]);
	expect(parse_release_channel("npm")).toBe("npm");
	expect(() => parse_release_channel("marketplace")).toThrow();
	expect(() => parse_release_channel("jsr")).toThrow();
});

test("package definitions preserve build and publication dependencies", () => {
	expect(release_package_definitions).toEqual([
		{
			id: "runtime",
			package_name: "svelte-effect-runtime",
			artifact_kind: "npm-tarball",
			build_dependencies: [],
			publish_dependencies: [],
			channels: ["npm", "github-release"],
		},
		{
			id: "grammars",
			package_name: "svelte-effect-runtime-grammars",
			artifact_kind: "npm-tarball",
			build_dependencies: [],
			publish_dependencies: [],
			channels: ["npm", "github-release"],
		},
		{
			id: "language-server",
			package_name: "svelte-effect-runtime-language-server",
			artifact_kind: "npm-tarball",
			build_dependencies: ["runtime"],
			publish_dependencies: ["grammars"],
			channels: ["npm", "github-release"],
		},
		{
			id: "vsix",
			package_name: "svelte-effect-runtime-vscode",
			artifact_kind: "vsix",
			build_dependencies: [],
			publish_dependencies: ["language-server"],
			channels: ["openvsx", "github-release"],
		},
	]);
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

test("pull requests verify synchronized candidates without publication", () => {
	const plan = plan_release({
		event: "pull_request",
		ref: "refs/pull/29/merge",
		commit: "candidate-commit",
		current_versions,
		previous_versions,
	});

	expect(plan).toMatchObject({
		version: "4.1.0",
		tag: "v4.1.0",
		intent: "verify",
		publish: false,
		dry_run: false,
		version_changed: true,
	});
});

test("ordinary pushes verify without entering publication", () => {
	const branch_plan = plan_release({
		event: "push",
		ref: "refs/heads/feature",
		commit: "ordinary-commit",
		current_versions,
		previous_versions,
	});
	const protected_branch_plan = plan_release({
		event: "push",
		ref: "refs/heads/master",
		commit: "ordinary-master-commit",
		current_versions,
		previous_versions: current_versions,
	});

	expect(branch_plan.intent).toBe("verify");
	expect(branch_plan.publish).toBe(false);
	expect(protected_branch_plan).toMatchObject({
		intent: "verify",
		publish: false,
		version_changed: false,
	});
});

test("a synchronized master version bump creates publication intent", () => {
	const plan = plan_release({
		event: "push",
		ref: "refs/heads/master",
		commit: "release-commit",
		current_versions,
		previous_versions,
	});

	expect(plan).toMatchObject({
		version: "4.1.0",
		previous_version: "4.0.0",
		intent: "publish",
		publish: true,
		dry_run: false,
		version_changed: true,
	});
	expect(plan.packages.map((pkg) => pkg.artifact_name)).toEqual([
		"svelte-effect-runtime-4.1.0.tgz",
		"svelte-effect-runtime-grammars-4.1.0.tgz",
		"svelte-effect-runtime-language-server-4.1.0.tgz",
		"svelte-effect-runtime-vscode-4.1.0.vsix",
	]);
});

test("unsynchronized or invalid current versions fail before planning", () => {
	expect(() =>
		plan_release({
			event: "push",
			ref: "refs/heads/master",
			commit: "release-commit",
			current_versions: {
				...current_versions,
				vsix: "4.1.1",
			},
			previous_versions,
		}),
	).toThrow(/current package versions are not synchronized/i);
	expect(() =>
		plan_release({
			event: "pull_request",
			ref: "refs/pull/29/merge",
			commit: "candidate-commit",
			current_versions: {
				...current_versions,
				runtime: "next",
			},
		}),
	).toThrow(/invalid semantic version/i);
	expect(() =>
		plan_release({
			event: "push",
			ref: "refs/heads/master",
			commit: "release-commit",
			current_versions,
			previous_versions: {
				...previous_versions,
				grammars: "3.9.0",
			},
		}),
	).toThrow(/previous package versions are not synchronized/i);
});

test("workflow dispatch is a dry run unless an exact master version is resumed", () => {
	const dry_run_plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/master",
		commit: "dry-run-commit",
		current_versions,
	});
	const resume_plan = plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/master",
		commit: "release-commit",
		current_versions,
		resume: { version: "4.1.0" },
	});

	expect(dry_run_plan).toMatchObject({
		intent: "verify",
		publish: false,
		dry_run: true,
	});
	expect(resume_plan).toMatchObject({
		intent: "resume",
		publish: true,
		dry_run: false,
	});
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/master",
			commit: "release-commit",
			current_versions,
			resume: { version: "4.0.0" },
		}),
	).toThrow(/resume version 4\.0\.0 does not match current version 4\.1\.0/i);
	expect(() =>
		plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/feature",
			commit: "release-commit",
			current_versions,
			resume: { version: "4.1.0" },
		}),
	).toThrow(/resume is only allowed from refs\/heads\/master/i);
});
