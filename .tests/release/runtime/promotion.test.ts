import {
	type GithubInspection,
	ProviderInspection,
	ProviderMutation,
} from "../../../build/release/provider-adapters.ts";
import {
	InspectPromotion,
	PromoteRelease,
	type PromotionOptions,
} from "../../../build/release/promotion.ts";
import { create_artifact_manifest } from "../../../build/release/artifact-manifest.ts";
import { plan_release, type ReleasePlan } from "../../../build/release/policy.ts";
import type { ProviderState } from "../../../build/release/registry-state.ts";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { basename } from "node:path";
import { expect, test } from "vitest";

type FakeState = {
	readonly calls: Array<string>;
	readonly inspections: Array<string>;
	readonly npm: Set<string>;
	readonly npm_mismatches: Set<string>;
	readonly github_assets: Set<string>;
	github_tag: "absent" | "matching" | "mismatched";
	github_release: "absent" | "draft" | "published";
	openvsx: "absent" | "matching" | "mismatched";
	npm_unavailable: boolean;
};

const commit = "abcdef0123456789abcdef0123456789abcdef01";
const previous_version = "4.0.0";
const version = "4.1.0";

test("dry run plans every channel without inspecting or mutating a provider", async () => {
	const fixture = make_fixture();
	const options = { ...fixture.options, dry_run: true };
	const state = await RunWithFake(
		PromoteRelease(fixture.plan, fixture.manifest, options),
		fixture,
	);

	expect(state.overall).toBe("dry-run");
	expect(state.pending_channels).toEqual(["npm", "openvsx", "github-release"]);
	expect(fixture.state.calls).toEqual([]);
	expect(fixture.state.inspections).toEqual([]);
});

test("fresh promotion honors dependencies and finalizes only after exact artifacts match", async () => {
	const fixture = make_fixture();
	const state = await RunWithFake(
		PromoteRelease(fixture.plan, fixture.manifest, fixture.options),
		fixture,
	);
	const calls = fixture.state.calls;
	const runtime = require_artifact_name(fixture.plan, "runtime");
	const grammars = require_artifact_name(fixture.plan, "grammars");
	const language_server = require_artifact_name(fixture.plan, "language-server");
	const vsix = require_artifact_name(fixture.plan, "vsix");

	expect(state.overall).toBe("complete");
	expect(state.completed_channels).toEqual(["npm", "openvsx", "github-release"]);
	expect(calls[0]).toBe("credentials");
	expect(calls.indexOf("github:tag")).toBeLessThan(calls.indexOf("github:draft"));
	expect(calls.indexOf("github:draft")).toBeLessThan(calls.indexOf(`npm:${runtime}`));
	expect(calls.indexOf(`npm:${runtime}`)).toBeLessThan(calls.indexOf(`npm:${language_server}`));
	expect(calls.indexOf(`npm:${grammars}`)).toBeLessThan(calls.indexOf(`npm:${language_server}`));
	expect(calls.indexOf(`npm:${language_server}`)).toBeLessThan(calls.indexOf(`openvsx:${vsix}`));
	expect(calls.at(-1)).toBe("github:finalize");
	expect(
		fixture.manifest.artifacts.every((artifact) =>
			calls.includes(`github:asset:${artifact.name}`),
		),
	).toBe(true);
});

test("resume skips matching npm and GitHub artifacts", async () => {
	const fixture = make_fixture();
	const runtime = fixture.manifest.artifacts.find(
		(artifact) => artifact.package_id === "runtime",
	);
	const first_asset = fixture.manifest.artifacts[0];
	const second_asset = fixture.manifest.artifacts[1];

	if (!runtime || !first_asset || !second_asset) {
		throw new Error("Test fixture did not include planned artifacts.");
	}

	fixture.state.npm.add(runtime.package_name);
	fixture.state.github_tag = "matching";
	fixture.state.github_release = "draft";
	fixture.state.github_assets.add(first_asset.name);
	fixture.state.github_assets.add(second_asset.name);

	const state = await RunWithFake(
		PromoteRelease(fixture.plan, fixture.manifest, fixture.options),
		fixture,
	);

	expect(state.overall).toBe("complete");
	expect(fixture.state.calls).not.toContain(`npm:${runtime.name}`);
	expect(fixture.state.calls).not.toContain(`github:asset:${first_asset.name}`);
	expect(fixture.state.calls).not.toContain(`github:asset:${second_asset.name}`);
	expect(fixture.state.calls).not.toContain("github:tag");
	expect(fixture.state.calls).not.toContain("github:draft");
});

test("integrity mismatch fails before any external write", async () => {
	const fixture = make_fixture();
	const runtime = fixture.manifest.artifacts.find(
		(artifact) => artifact.package_id === "runtime",
	);

	if (!runtime) {
		throw new Error("Test fixture did not include the runtime artifact.");
	}

	fixture.state.npm_mismatches.add(runtime.package_name);

	await expect(
		RunWithFake(PromoteRelease(fixture.plan, fixture.manifest, fixture.options), fixture),
	).rejects.toThrow(/integrity mismatch/i);
	expect(fixture.state.calls).toEqual(["credentials"]);
});

test("tag mismatch fails before publication", async () => {
	const fixture = make_fixture();

	fixture.state.github_tag = "mismatched";

	await expect(
		RunWithFake(PromoteRelease(fixture.plan, fixture.manifest, fixture.options), fixture),
	).rejects.toThrow(/GitHub tag mismatch/i);
	expect(fixture.state.calls).toEqual(["credentials"]);
});

test("provider outage is bounded and leaves an inspectable partial state", async () => {
	const fixture = make_fixture();

	fixture.state.npm_unavailable = true;

	await expect(
		RunWithFake(PromoteRelease(fixture.plan, fixture.manifest, fixture.options), fixture),
	).rejects.toThrow(/remained unavailable after 3 attempts/i);
	expect(fixture.state.calls).toEqual(["credentials"]);
	expect(fixture.state.inspections.filter((entry) => entry.startsWith("npm:")).length).toBe(3);

	const inspected = await RunWithFake(
		InspectPromotion(fixture.plan, fixture.manifest, fixture.options),
		fixture,
	);

	expect(inspected.overall).toBe("partial");
	expect(inspected.pending_channels).toContain("npm");
	expect(inspected.retry_guidance).toMatch(/resume the exact 4\.1\.0 release/i);
});

function make_fixture() {
	const plan = make_publish_plan();
	const manifest = create_artifact_manifest(
		plan,
		plan.packages.map((pkg) => ({
			name: pkg.artifact_name,
			bytes: new TextEncoder().encode(`verified ${pkg.id}`),
		})),
	);
	const state: FakeState = {
		calls: [],
		inspections: [],
		npm: new Set(),
		npm_mismatches: new Set(),
		github_assets: new Set(),
		github_tag: "absent",
		github_release: "absent",
		openvsx: "absent",
		npm_unavailable: false,
	};
	const options: PromotionOptions = {
		repository: "usebarekey/svelte-effect-runtime",
		artifact_dir: "artifacts",
		notes: "Release 4.1.0",
		max_attempts: 3,
		probe_delay_ms: 0,
		request_timeout_ms: 100,
		command_timeout_ms: 100,
		dry_run: false,
	};

	return {
		plan,
		manifest,
		state,
		options,
		inspection_layer: make_inspection_layer(state),
		mutation_layer: make_mutation_layer(state, manifest.artifacts),
	};
}

function make_publish_plan(): ReleasePlan {
	const versions = {
		runtime: version,
		grammars: version,
		"language-server": version,
		vsix: version,
	};
	return plan_release({
		event: "workflow_dispatch",
		ref: "refs/heads/candidate",
		commit,
		current_versions: versions,
		mode: "release",
		repository_state: {
			candidate_head: commit,
			candidate_is_on_master: true,
			greatest_release_version: previous_version,
			current_tag_exists: false,
		},
	});
}

function make_inspection_layer(state: FakeState) {
	return Layer.succeed(ProviderInspection, {
		inspect_npm: (request) =>
			Effect.sync(() => {
				state.inspections.push(`npm:${request.package_name}`);

				if (state.npm_unavailable) {
					return unavailable("https://registry.npmjs.org");
				}

				if (state.npm_mismatches.has(request.package_name)) {
					return mismatched("https://registry.npmjs.org", request.expected_digest);
				}

				return state.npm.has(request.package_name)
					? matching("https://registry.npmjs.org", request.expected_digest)
					: absent("https://registry.npmjs.org");
			}),
		inspect_openvsx: (request) =>
			Effect.sync(() => {
				state.inspections.push("openvsx");

				if (state.openvsx === "mismatched") {
					return mismatched("https://open-vsx.org", request.expected_digest);
				}

				return state.openvsx === "matching"
					? matching("https://open-vsx.org", request.expected_digest)
					: absent("https://open-vsx.org");
			}),
		inspect_github: (request) =>
			Effect.sync(() => {
				state.inspections.push("github");

				return make_github_inspection(state, request);
			}),
	});
}

function make_mutation_layer(
	state: FakeState,
	artifacts: ReadonlyArray<{ readonly name: string; readonly package_name: string }>,
) {
	return Layer.succeed(ProviderMutation, {
		require_credentials: Effect.sync(() => {
			state.calls.push("credentials");
		}),
		create_github_tag: () =>
			Effect.sync(() => {
				state.calls.push("github:tag");
				state.github_tag = "matching";
			}),
		upsert_draft_github_release: () =>
			Effect.sync(() => {
				state.calls.push("github:draft");
				state.github_release = "draft";
			}),
		publish_npm: (request) =>
			Effect.sync(() => {
				const artifact = artifacts.find(
					(candidate) => candidate.name === basename(request.path),
				);

				if (!artifact) {
					throw new Error(`Unknown npm artifact ${request.path}.`);
				}

				state.calls.push(`npm:${artifact.name}`);
				state.npm.add(artifact.package_name);
			}),
		publish_openvsx: (request) =>
			Effect.sync(() => {
				state.calls.push(`openvsx:${basename(request.path)}`);
				state.openvsx = "matching";
			}),
		upload_github_asset: (request) =>
			Effect.sync(() => {
				const name = basename(request.path);

				state.calls.push(`github:asset:${name}`);
				state.github_assets.add(name);
			}),
		finalize_github_release: () =>
			Effect.sync(() => {
				state.calls.push("github:finalize");
				state.github_release = "published";
			}),
	});
}

function make_github_inspection(
	state: FakeState,
	request: Parameters<(typeof ProviderInspection.Service)["inspect_github"]>[0],
): GithubInspection {
	const tag =
		state.github_tag === "matching"
			? ({ _tag: "Matching", url: "https://github.com/tag", actual: request.commit } as const)
			: state.github_tag === "mismatched"
				? ({
						_tag: "Mismatched",
						url: "https://github.com/tag",
						expected: request.commit,
						actual: "0".repeat(40),
					} as const)
				: ({ _tag: "Absent", url: "https://github.com/tag" } as const);
	const release =
		state.github_release === "absent"
			? ({ _tag: "Absent", url: "https://github.com/release" } as const)
			: ({
					_tag: "Matching",
					url: "https://github.com/release",
					actual: state.github_release,
					draft: state.github_release === "draft",
					notes_match: true,
				} as const);
	const assets = Object.fromEntries(
		request.assets.map((artifact) => [
			artifact.name,
			state.github_assets.has(artifact.name)
				? matching("https://github.com/asset", artifact.expected_digest)
				: absent("https://github.com/asset"),
		]),
	);

	return { tag, release, assets };
}

function require_artifact_name(
	plan: ReleasePlan,
	package_id: ReleasePlan["packages"][number]["id"],
): string {
	const pkg = plan.packages.find((candidate) => candidate.id === package_id);

	if (!pkg) {
		throw new Error(`Missing planned package ${package_id}.`);
	}

	return pkg.artifact_name;
}

function matching(url: string, digest: string): ProviderState {
	return { _tag: "Matching", url, digest };
}

function absent(url: string): ProviderState {
	return { _tag: "Absent", url };
}

function mismatched(url: string, expected_digest: string): ProviderState {
	return {
		_tag: "Mismatched",
		url,
		expected_digest,
		actual_digest: `${expected_digest}-different`,
	};
}

function unavailable(url: string): ProviderState {
	return {
		_tag: "ProviderUnavailable",
		url,
		status: 503,
		reason: "provider outage",
	};
}

function RunWithFake<A, E>(
	effect: Effect.Effect<A, E, ProviderInspection | ProviderMutation | NodeServices.NodeServices>,
	fixture: ReturnType<typeof make_fixture>,
): Promise<A> {
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(fixture.inspection_layer),
			Effect.provide(fixture.mutation_layer),
			Effect.provide(NodeServices.layer),
		),
	);
}
