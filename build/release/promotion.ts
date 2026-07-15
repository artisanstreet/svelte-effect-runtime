import {
	type GithubIdentityState,
	type GithubInspection,
	ProviderInspection,
	ProviderMutation,
} from "./provider-adapters.ts";
import { decide_probe, type ProviderState } from "./registry-state.ts";
import type { ArtifactManifest, ArtifactManifestEntry } from "./artifact-manifest.ts";
import type { ReleaseChannel, ReleasePackageId, ReleasePlan } from "./policy.ts";
import { Duration, Effect, Path } from "effect";

export type PromotionOptions = {
	readonly repository: string;
	readonly artifact_dir: string;
	readonly notes: string;
	readonly max_attempts: number;
	readonly probe_delay_ms: number;
	readonly request_timeout_ms: number;
	readonly command_timeout_ms: number;
	readonly dry_run: boolean;
};

export type ArtifactPublicationState = {
	readonly status: "planned" | "complete" | "pending" | "failed";
	readonly url?: string;
	readonly digest?: string;
	readonly diagnostic?: string;
};

export type ChannelPublicationState = {
	readonly status: "planned" | "complete" | "pending" | "failed";
	readonly url?: string;
	readonly provider_ms: number;
	readonly artifacts: Readonly<Record<string, ArtifactPublicationState>>;
};

export type PromotionState = {
	readonly schema_version: 1;
	readonly commit: string;
	readonly version: string;
	readonly tag: string;
	readonly dry_run: boolean;
	readonly overall: "dry-run" | "complete" | "partial" | "failed";
	readonly channels: Readonly<Record<ReleaseChannel, ChannelPublicationState>>;
	readonly completed_channels: ReadonlyArray<ReleaseChannel>;
	readonly pending_channels: ReadonlyArray<ReleaseChannel>;
	readonly retry_guidance: string;
	readonly total_provider_ms: number;
};

type ProviderTimings = Record<ReleaseChannel, number>;

type PromotionContext = {
	readonly plan: ReleasePlan;
	readonly manifest: ArtifactManifest;
	readonly options: PromotionOptions;
	readonly timings: ProviderTimings;
};

const npm_package_ids = ["runtime", "grammars", "language-server"] as const;

export const InspectPromotion = (
	plan: ReleasePlan,
	manifest: ArtifactManifest,
	options: PromotionOptions,
) =>
	Effect.gen(function* () {
		const context = make_context(plan, manifest, options);
		const snapshot = yield* InspectAll(context);

		return make_promotion_state(context, snapshot);
	});

export const PromoteRelease = (
	plan: ReleasePlan,
	manifest: ArtifactManifest,
	options: PromotionOptions,
) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const context = make_context(plan, manifest, options);

		validate_promotion_inputs(context);

		if (options.dry_run || plan.dry_run || !plan.publish) {
			return make_dry_run_state(context);
		}

		yield* mutation.require_credentials.pipe(map_provider_error("credential preflight"));

		const preflight = yield* PreflightPromotion(context);
		const preflight_state = make_promotion_state(context, preflight);

		if (preflight_state.overall === "complete") {
			return preflight_state;
		}

		if (
			preflight.github.release._tag === "Matching" &&
			preflight.github.release.draft === false
		) {
			return yield* Effect.fail(
				new Error(
					"Published GitHub release exists while another required channel is incomplete.",
				),
			);
		}

		yield* PrepareGithub(context);

		/**
		 * npm publication follows its dependency graph while release assets upload independently.
		 */
		yield* Effect.all([PublishNpmAndOpenVsx(context), PublishGithubAssets(context)], {
			concurrency: "unbounded",
		});

		yield* FinalizeGithub(context);

		const snapshot = yield* InspectAll(context);
		const state = make_promotion_state(context, snapshot);

		if (state.overall !== "complete") {
			return yield* Effect.fail(
				new Error(`Promotion finished with incomplete state: ${state.retry_guidance}`),
			);
		}

		return state;
	});

export function format_promotion_summary(state: PromotionState): string {
	const channel_rows = (["npm", "openvsx", "github-release"] as const).map((channel) => {
		const result = state.channels[channel];
		const destination = result.url ? `[open](${result.url})` : "—";

		return `| ${channel} | ${result.status} | ${result.provider_ms} ms | ${destination} |`;
	});
	const completed = state.completed_channels.join(", ") || "none";
	const pending = state.pending_channels.join(", ") || "none";

	return [
		`## Release promotion ${state.tag}`,
		"",
		`**Outcome:** ${state.overall}`,
		"",
		"| Channel | State | Provider time | Result |",
		"| --- | --- | ---: | --- |",
		...channel_rows,
		"",
		`**Completed:** ${completed}`,
		"",
		`**Pending:** ${pending}`,
		"",
		`**Retry guidance:** ${state.retry_guidance}`,
		"",
	].join("\n");
}

const PreflightPromotion = (context: PromotionContext) =>
	Effect.gen(function* () {
		const npm_artifacts = npm_package_ids.map((package_id) =>
			require_artifact(context, package_id),
		);
		const vsix_artifact = require_artifact(context, "vsix");
		const [npm_entries, openvsx, github] = yield* Effect.all(
			[
				Effect.all(
					npm_artifacts.map((artifact) =>
						InspectProviderBeforeMutation(context, "npm", () =>
							InspectNpmArtifact(context, artifact),
						).pipe(Effect.map((state) => [artifact.name, state] as const)),
					),
				),
				InspectProviderBeforeMutation(context, "openvsx", () =>
					InspectOpenVsxArtifact(context, vsix_artifact),
				),
				InspectGithubBeforeMutation(context),
			] as const,
			{ concurrency: "unbounded" },
		);

		validate_github_inspection(github, false);

		return {
			npm: Object.fromEntries(npm_entries) as Readonly<Record<string, ProviderState>>,
			openvsx,
			github,
		};
	});

const PrepareGithub = (context: PromotionContext) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const inspection = yield* InspectGithubBeforeMutation(context);
		const request = github_mutation_request(context);

		validate_github_inspection(inspection, false);

		if (inspection.tag._tag === "Absent") {
			yield* TrackProvider(
				context,
				"github-release",
				mutation.create_github_tag(request),
			).pipe(map_provider_error("GitHub tag creation"));
		}

		if (inspection.release._tag === "Absent") {
			yield* TrackProvider(
				context,
				"github-release",
				mutation.upsert_draft_github_release(request),
			).pipe(map_provider_error("GitHub draft release creation"));
		}

		yield* ProbeGithub(
			context,
			(current) => {
				validate_github_inspection(current, false);

				return (
					current.tag._tag === "Matching" &&
					current.release._tag === "Matching" &&
					current.release.draft === true
				);
			},
			"GitHub tag and draft release did not become visible",
		);
	});

const PublishNpmAndOpenVsx = (context: PromotionContext) =>
	Effect.gen(function* () {
		yield* Effect.all(
			[PublishNpmArtifact(context, "runtime"), PublishNpmArtifact(context, "grammars")],
			{ concurrency: "unbounded" },
		);
		yield* PublishNpmArtifact(context, "language-server");
		yield* PublishOpenVsxArtifact(context);
	});

const PublishNpmArtifact = (context: PromotionContext, package_id: ReleasePackageId) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const artifact = require_artifact(context, package_id);
		const initial = yield* InspectProviderBeforeMutation(context, "npm", () =>
			InspectNpmArtifact(context, artifact),
		);

		if (initial._tag === "Matching") {
			return initial;
		}

		yield* TrackProvider(
			context,
			"npm",
			mutation.publish_npm(yield* publish_artifact_request(context, artifact)),
		).pipe(map_provider_error(`npm publication of ${artifact.name}`));

		return yield* ProbeProvider(
			context,
			() => InspectNpmArtifact(context, artifact),
			artifact.name,
		);
	});

const PublishOpenVsxArtifact = (context: PromotionContext) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const artifact = require_artifact(context, "vsix");
		const initial = yield* InspectProviderBeforeMutation(context, "openvsx", () =>
			InspectOpenVsxArtifact(context, artifact),
		);

		if (initial._tag === "Matching") {
			return initial;
		}

		yield* TrackProvider(
			context,
			"openvsx",
			mutation.publish_openvsx(yield* publish_artifact_request(context, artifact)),
		).pipe(map_provider_error(`OpenVSX publication of ${artifact.name}`));

		return yield* ProbeProvider(
			context,
			() => InspectOpenVsxArtifact(context, artifact),
			artifact.name,
		);
	});

const PublishGithubAssets = (context: PromotionContext) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const inspection = yield* InspectGithubBeforeMutation(context);

		validate_github_inspection(inspection, false);

		if (inspection.release._tag !== "Matching" || inspection.release.draft !== true) {
			return yield* Effect.fail(
				new Error("GitHub assets can only be uploaded to the verified draft release."),
			);
		}

		yield* Effect.all(
			context.manifest.artifacts.map((artifact) => {
				const state = inspection.assets[artifact.name];

				if (!state) {
					return Effect.fail(new Error(`GitHub did not report ${artifact.name}.`));
				}

				assert_publishable_state(state, artifact.name);

				if (state._tag === "Matching") {
					return Effect.void;
				}

				return Effect.gen(function* () {
					const path = yield* Path.Path;

					yield* TrackProvider(
						context,
						"github-release",
						mutation.upload_github_asset({
							...github_mutation_request(context),
							path: path.join(context.options.artifact_dir, artifact.name),
						}),
					).pipe(map_provider_error(`GitHub upload of ${artifact.name}`));
				});
			}),
			{ concurrency: "unbounded" },
		);

		yield* ProbeGithub(
			context,
			(current) => {
				validate_github_inspection(current, false);

				return context.manifest.artifacts.every(
					(artifact) => current.assets[artifact.name]?._tag === "Matching",
				);
			},
			"GitHub release assets did not become visible",
		);
	});

const FinalizeGithub = (context: PromotionContext) =>
	Effect.gen(function* () {
		const mutation = yield* ProviderMutation;
		const inspection = yield* InspectGithubBeforeMutation(context);

		validate_github_inspection(inspection, true);

		if (inspection.release._tag === "Matching" && inspection.release.draft === false) {
			return;
		}

		yield* TrackProvider(
			context,
			"github-release",
			mutation.finalize_github_release(github_mutation_request(context)),
		).pipe(map_provider_error("GitHub release finalization"));

		yield* ProbeGithub(
			context,
			(current) => {
				validate_github_inspection(current, true);

				return current.release._tag === "Matching" && current.release.draft === false;
			},
			"GitHub release did not become public",
		);
	});

const InspectAll = (context: PromotionContext) =>
	Effect.gen(function* () {
		const npm_artifacts = npm_package_ids.map((package_id) =>
			require_artifact(context, package_id),
		);
		const vsix_artifact = require_artifact(context, "vsix");
		const [npm_entries, openvsx, github] = yield* Effect.all(
			[
				Effect.all(
					npm_artifacts.map((artifact) =>
						InspectNpmArtifact(context, artifact).pipe(
							Effect.map((state) => [artifact.name, state] as const),
						),
					),
				),
				InspectOpenVsxArtifact(context, vsix_artifact),
				InspectGithub(context),
			] as const,
			{ concurrency: "unbounded" },
		);

		return {
			npm: Object.fromEntries(npm_entries) as Readonly<Record<string, ProviderState>>,
			openvsx,
			github,
		};
	});

const InspectNpmArtifact = (context: PromotionContext, artifact: ArtifactManifestEntry) =>
	Effect.gen(function* () {
		const inspection = yield* ProviderInspection;

		return yield* TrackProvider(
			context,
			"npm",
			inspection.inspect_npm({
				package_name: artifact.package_name,
				version: context.plan.version,
				expected_digest: artifact.sha512_sri,
				timeout_ms: context.options.request_timeout_ms,
			}),
		).pipe(map_provider_error(`npm inspection of ${artifact.name}`));
	});

const InspectOpenVsxArtifact = (context: PromotionContext, artifact: ArtifactManifestEntry) =>
	Effect.gen(function* () {
		const inspection = yield* ProviderInspection;

		return yield* TrackProvider(
			context,
			"openvsx",
			inspection.inspect_openvsx({
				package_name: artifact.package_name,
				version: context.plan.version,
				expected_digest: artifact.sha256,
				timeout_ms: context.options.request_timeout_ms,
			}),
		).pipe(map_provider_error(`OpenVSX inspection of ${artifact.name}`));
	});

const InspectGithub = (context: PromotionContext) =>
	Effect.gen(function* () {
		const inspection = yield* ProviderInspection;

		return yield* TrackProvider(
			context,
			"github-release",
			inspection.inspect_github({
				repository: context.options.repository,
				tag: context.plan.tag,
				commit: context.plan.commit,
				notes: context.options.notes,
				assets: context.manifest.artifacts.map((artifact) => ({
					name: artifact.name,
					expected_digest: artifact.sha256,
				})),
				timeout_ms: context.options.request_timeout_ms,
			}),
		).pipe(map_provider_error("GitHub inspection"));
	});

const InspectProviderBeforeMutation = (
	context: PromotionContext,
	channel: ReleaseChannel,
	inspect: () => Effect.Effect<ProviderState, Error, ProviderInspection>,
	attempt = 1,
): Effect.Effect<ProviderState, Error, ProviderInspection> =>
	Effect.gen(function* () {
		const state = yield* inspect();

		if (state._tag !== "ProviderUnavailable") {
			assert_publishable_state(state, channel);

			return state;
		}

		if (attempt >= context.options.max_attempts) {
			return yield* Effect.fail(
				new Error(
					`${channel} remained unavailable after ${attempt} attempts: ${state.reason}`,
				),
			);
		}

		yield* Effect.sleep(Duration.millis(context.options.probe_delay_ms));

		return yield* InspectProviderBeforeMutation(context, channel, inspect, attempt + 1);
	});

const InspectGithubBeforeMutation = (
	context: PromotionContext,
	attempt = 1,
): Effect.Effect<GithubInspection, Error, ProviderInspection> =>
	Effect.gen(function* () {
		const inspection = yield* InspectGithub(context);

		if (!github_is_unavailable(inspection)) {
			return inspection;
		}

		if (attempt >= context.options.max_attempts) {
			return yield* Effect.fail(
				new Error(`GitHub remained unavailable after ${attempt} attempts.`),
			);
		}

		yield* Effect.sleep(Duration.millis(context.options.probe_delay_ms));

		return yield* InspectGithubBeforeMutation(context, attempt + 1);
	});

const ProbeProvider = (
	context: PromotionContext,
	inspect: () => Effect.Effect<ProviderState, Error, ProviderInspection>,
	artifact_name: string,
	attempt = 1,
): Effect.Effect<ProviderState, Error, ProviderInspection> =>
	Effect.gen(function* () {
		const state = yield* inspect();
		const decision = decide_probe(state, {
			attempt,
			max_attempts: context.options.max_attempts,
		});

		if (decision._tag === "Complete") {
			return decision.state;
		}

		if (decision._tag === "Failed") {
			return yield* Effect.fail(provider_state_error(artifact_name, decision.state));
		}

		if (decision._tag === "Exhausted") {
			return yield* Effect.fail(new Error(`${artifact_name}: ${decision.diagnostic}`));
		}

		yield* Effect.sleep(Duration.millis(context.options.probe_delay_ms));

		return yield* ProbeProvider(context, inspect, artifact_name, decision.next_attempt);
	});

const ProbeGithub = (
	context: PromotionContext,
	is_complete: (inspection: GithubInspection) => boolean,
	diagnostic: string,
	attempt = 1,
): Effect.Effect<GithubInspection, Error, ProviderInspection> =>
	Effect.gen(function* () {
		const inspection = yield* InspectGithub(context);

		if (is_complete(inspection)) {
			return inspection;
		}

		if (attempt >= context.options.max_attempts) {
			return yield* Effect.fail(new Error(`${diagnostic} after ${attempt} attempts.`));
		}

		yield* Effect.sleep(Duration.millis(context.options.probe_delay_ms));

		return yield* ProbeGithub(context, is_complete, diagnostic, attempt + 1);
	});

const TrackProvider = <A, E, R>(
	context: PromotionContext,
	channel: ReleaseChannel,
	effect: Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const started_at = Date.now();

		return yield* effect.pipe(
			Effect.ensuring(
				Effect.sync(() => {
					context.timings[channel] += Date.now() - started_at;
				}),
			),
		);
	});

function make_context(
	plan: ReleasePlan,
	manifest: ArtifactManifest,
	options: PromotionOptions,
): PromotionContext {
	return {
		plan,
		manifest,
		options,
		timings: { npm: 0, openvsx: 0, "github-release": 0 },
	};
}

function validate_promotion_inputs(context: PromotionContext): void {
	const { plan, manifest, options } = context;

	if (
		manifest.commit !== plan.commit ||
		manifest.version !== plan.version ||
		manifest.tag !== plan.tag
	) {
		throw new Error("Promotion manifest does not match the canonical release plan.");
	}

	if (!arrays_equal(manifest.channels, plan.channels)) {
		throw new Error("Promotion manifest channels do not match the release plan.");
	}

	if (!Number.isSafeInteger(options.max_attempts) || options.max_attempts < 1) {
		throw new Error("Promotion max_attempts must be a positive integer.");
	}

	for (const timeout of [
		options.request_timeout_ms,
		options.command_timeout_ms,
		options.probe_delay_ms,
	]) {
		if (!Number.isSafeInteger(timeout) || timeout < 0) {
			throw new Error("Promotion timeouts and probe delays must be non-negative integers.");
		}
	}

	for (const [index, artifact] of manifest.artifacts.entries()) {
		const planned = plan.packages[index];

		if (
			!planned ||
			artifact.name !== planned.artifact_name ||
			artifact.package_id !== planned.id ||
			artifact.package_name !== planned.package_name ||
			artifact.kind !== planned.artifact_kind
		) {
			throw new Error(`Promotion artifact identity drift at position ${index + 1}.`);
		}
	}
}

function validate_github_inspection(
	inspection: GithubInspection,
	require_all_assets: boolean,
): void {
	assert_github_identity(inspection.tag, "GitHub tag");
	assert_github_identity(inspection.release, "GitHub release");

	if (inspection.release._tag === "Matching" && inspection.tag._tag === "Absent") {
		throw new Error("GitHub release exists without the planned tag.");
	}

	for (const [name, state] of Object.entries(inspection.assets)) {
		assert_publishable_state(state, `GitHub asset ${name}`);
	}

	const missing_assets = Object.values(inspection.assets).some(
		(state) => state._tag !== "Matching",
	);

	if (
		inspection.release._tag === "Matching" &&
		inspection.release.draft === false &&
		missing_assets
	) {
		throw new Error("Published GitHub release is missing verified assets.");
	}

	if (require_all_assets && missing_assets) {
		throw new Error("GitHub release cannot be finalized before every asset matches.");
	}
}

function assert_github_identity(state: GithubIdentityState, label: string): void {
	if (state._tag === "Mismatched") {
		throw new Error(`${label} mismatch: expected ${state.expected}, observed ${state.actual}.`);
	}

	if (state._tag === "AuthenticationFailure") {
		throw new Error(`${label} authentication failed with HTTP ${state.status}.`);
	}

	if (state._tag === "ProviderRejected") {
		throw new Error(`${label} was rejected: ${state.reason}`);
	}
}

function assert_publishable_state(state: ProviderState, label: string): void {
	if (
		state._tag === "Mismatched" ||
		state._tag === "AuthenticationFailure" ||
		state._tag === "ProviderRejected"
	) {
		throw provider_state_error(label, state);
	}
}

function provider_state_error(
	label: string,
	state: Exclude<ProviderState, { _tag: "Absent" | "Matching" | "ProviderUnavailable" }>,
): Error {
	if (state._tag === "Mismatched") {
		return new Error(
			`${label} integrity mismatch: expected ${state.expected_digest}, observed ${state.actual_digest}.`,
		);
	}

	if (state._tag === "AuthenticationFailure") {
		return new Error(`${label} authentication failed with HTTP ${state.status}.`);
	}

	return new Error(`${label} was rejected: ${state.reason}`);
}

function require_artifact(
	context: PromotionContext,
	package_id: ReleasePackageId,
): ArtifactManifestEntry {
	const artifact = context.manifest.artifacts.find(
		(candidate) => candidate.package_id === package_id,
	);

	if (!artifact) {
		throw new Error(`Missing promotion artifact for ${package_id}.`);
	}

	return artifact;
}

const publish_artifact_request = (context: PromotionContext, artifact: ArtifactManifestEntry) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;

		return {
			path: path.join(context.options.artifact_dir, artifact.name),
			cwd: context.options.artifact_dir,
			timeout_ms: context.options.command_timeout_ms,
		};
	});

function github_mutation_request(context: PromotionContext) {
	return {
		repository: context.options.repository,
		tag: context.plan.tag,
		commit: context.plan.commit,
		notes: context.options.notes,
		timeout_ms: context.options.command_timeout_ms,
	};
}

function github_is_unavailable(inspection: GithubInspection): boolean {
	return (
		inspection.tag._tag === "ProviderUnavailable" ||
		inspection.release._tag === "ProviderUnavailable" ||
		Object.values(inspection.assets).some((state) => state._tag === "ProviderUnavailable")
	);
}

function make_dry_run_state(context: PromotionContext): PromotionState {
	const artifacts = Object.fromEntries(
		context.manifest.artifacts.map((artifact) => [artifact.name, { status: "planned" }]),
	) as Readonly<Record<string, ArtifactPublicationState>>;
	const channels = Object.fromEntries(
		context.plan.channels.map((channel) => [
			channel,
			{
				status: "planned",
				provider_ms: 0,
				artifacts: filter_channel_artifacts(context, channel, artifacts),
			},
		]),
	) as Readonly<Record<ReleaseChannel, ChannelPublicationState>>;

	return {
		schema_version: 1,
		commit: context.plan.commit,
		version: context.plan.version,
		tag: context.plan.tag,
		dry_run: true,
		overall: "dry-run",
		channels,
		completed_channels: [],
		pending_channels: [...context.plan.channels],
		retry_guidance: "Dry run completed without external inspection or mutation.",
		total_provider_ms: 0,
	};
}

function make_promotion_state(
	context: PromotionContext,
	snapshot: {
		readonly npm: Readonly<Record<string, ProviderState>>;
		readonly openvsx: ProviderState;
		readonly github: GithubInspection;
	},
): PromotionState {
	const npm = make_provider_channel_state(snapshot.npm, context.timings.npm);
	const openvsx = make_provider_channel_state(
		{ [require_artifact(context, "vsix").name]: snapshot.openvsx },
		context.timings.openvsx,
	);
	const github = make_github_channel_state(
		context,
		snapshot.github,
		context.timings["github-release"],
	);
	const channels: Readonly<Record<ReleaseChannel, ChannelPublicationState>> = {
		npm,
		openvsx,
		"github-release": github,
	};
	const completed_channels = context.plan.channels.filter(
		(channel) => channels[channel].status === "complete",
	);
	const failed_channels = context.plan.channels.filter(
		(channel) => channels[channel].status === "failed",
	);
	const pending_channels = context.plan.channels.filter(
		(channel) => channels[channel].status !== "complete",
	);
	const overall =
		completed_channels.length === context.plan.channels.length
			? "complete"
			: failed_channels.length > 0
				? "failed"
				: "partial";
	const retry_guidance =
		overall === "complete"
			? "All required channels match the verified artifact manifest."
			: failed_channels.length > 0
				? `Resolve identity or authentication failures in ${failed_channels.join(", ")} before retrying.`
				: `Resume the exact ${context.plan.version} release at commit ${context.plan.commit}; matching artifacts will be skipped.`;

	return {
		schema_version: 1,
		commit: context.plan.commit,
		version: context.plan.version,
		tag: context.plan.tag,
		dry_run: false,
		overall,
		channels,
		completed_channels,
		pending_channels,
		retry_guidance,
		total_provider_ms: Object.values(context.timings).reduce(
			(total, value) => total + value,
			0,
		),
	};
}

function make_provider_channel_state(
	states: Readonly<Record<string, ProviderState>>,
	provider_ms: number,
): ChannelPublicationState {
	const artifacts = Object.fromEntries(
		Object.entries(states).map(([name, state]) => [name, provider_artifact_state(state)]),
	) as Readonly<Record<string, ArtifactPublicationState>>;
	const values = Object.values(artifacts);
	const status = values.some((state) => state.status === "failed")
		? "failed"
		: values.every((state) => state.status === "complete")
			? "complete"
			: "pending";
	const url = values.find((state) => state.url)?.url;

	return { status, ...(url ? { url } : {}), provider_ms, artifacts };
}

function make_github_channel_state(
	context: PromotionContext,
	inspection: GithubInspection,
	provider_ms: number,
): ChannelPublicationState {
	const artifact_states = Object.fromEntries(
		Object.entries(inspection.assets).map(([name, state]) => [
			name,
			provider_artifact_state(state),
		]),
	) as Readonly<Record<string, ArtifactPublicationState>>;
	const identity_states = [inspection.tag, inspection.release];
	const has_identity_failure = identity_states.some((state) =>
		["Mismatched", "AuthenticationFailure", "ProviderRejected"].includes(state._tag),
	);
	const has_asset_failure = Object.values(artifact_states).some(
		(state) => state.status === "failed",
	);
	const all_assets_match = context.manifest.artifacts.every(
		(artifact) => artifact_states[artifact.name]?.status === "complete",
	);
	const complete =
		inspection.tag._tag === "Matching" &&
		inspection.release._tag === "Matching" &&
		inspection.release.draft === false &&
		all_assets_match;
	const published_without_assets =
		inspection.release._tag === "Matching" &&
		inspection.release.draft === false &&
		!all_assets_match;
	const status = complete
		? "complete"
		: has_identity_failure || has_asset_failure || published_without_assets
			? "failed"
			: "pending";
	const url = inspection.release.url || inspection.tag.url;

	return { status, url, provider_ms, artifacts: artifact_states };
}

function provider_artifact_state(state: ProviderState): ArtifactPublicationState {
	if (state._tag === "Matching") {
		return { status: "complete", url: state.url, digest: state.digest };
	}

	if (state._tag === "Absent") {
		return { status: "pending", url: state.url, diagnostic: "Artifact is absent." };
	}

	if (state._tag === "Mismatched") {
		return {
			status: "failed",
			url: state.url,
			diagnostic: `Expected ${state.expected_digest}, observed ${state.actual_digest}.`,
		};
	}

	return {
		status: state._tag === "ProviderUnavailable" ? "pending" : "failed",
		url: state.url,
		diagnostic:
			state._tag === "AuthenticationFailure"
				? `Authentication failed with HTTP ${state.status}.`
				: state.reason,
	};
}

function filter_channel_artifacts(
	context: PromotionContext,
	channel: ReleaseChannel,
	artifacts: Readonly<Record<string, ArtifactPublicationState>>,
): Readonly<Record<string, ArtifactPublicationState>> {
	return Object.fromEntries(
		context.plan.packages
			.filter((pkg) => pkg.channels.includes(channel))
			.map((pkg) => [pkg.artifact_name, artifacts[pkg.artifact_name]]),
	);
}

function arrays_equal<A>(left: ReadonlyArray<A>, right: ReadonlyArray<A>): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

const map_provider_error =
	(label: string) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Error, R> =>
		effect.pipe(
			Effect.mapError((cause) =>
				cause instanceof Error ? cause : new Error(`${label} failed: ${String(cause)}`),
			),
		);
