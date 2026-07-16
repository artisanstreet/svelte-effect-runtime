import { Context, Duration, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { classify_provider_state, type ProviderState } from "./registry-state.ts";
import { NodeServices } from "@effect/platform-node";
import type { ReleaseChannel } from "./policy.ts";
import { RunCommand } from "../node-utils.ts";

export type InspectArtifactRequest = {
	readonly package_name: string;
	readonly version: string;
	readonly expected_digest: string;
	readonly timeout_ms: number;
};

export type InspectGithubRequest = {
	readonly repository: string;
	readonly tag: string;
	readonly commit: string;
	readonly notes: string;
	readonly assets: ReadonlyArray<{
		readonly name: string;
		readonly expected_digest: string;
	}>;
	readonly timeout_ms: number;
};

export type GithubIdentityState =
	| {
			readonly _tag: "Absent";
			readonly url: string;
	  }
	| {
			readonly _tag: "Matching";
			readonly url: string;
			readonly actual: string;
	  }
	| {
			readonly _tag: "Mismatched";
			readonly url: string;
			readonly expected: string;
			readonly actual: string;
	  }
	| {
			readonly _tag: "AuthenticationFailure";
			readonly url: string;
			readonly status: number;
	  }
	| {
			readonly _tag: "ProviderRejected";
			readonly url: string;
			readonly status: number;
			readonly reason: string;
	  }
	| {
			readonly _tag: "ProviderUnavailable";
			readonly url: string;
			readonly status: number | undefined;
			readonly reason: string;
	  };

export type GithubReleaseState = GithubIdentityState & {
	readonly draft?: boolean;
	readonly notes_match?: boolean;
};

export type GithubInspection = {
	readonly tag: GithubIdentityState;
	readonly release: GithubReleaseState;
	readonly assets: Readonly<Record<string, ProviderState>>;
};

export type PublishArtifactRequest = {
	readonly path: string;
	readonly cwd: string;
	readonly timeout_ms: number;
};

export type GithubMutationRequest = {
	readonly repository: string;
	readonly tag: string;
	readonly commit: string;
	readonly notes: string;
	readonly timeout_ms: number;
	readonly release_exists?: boolean;
};

export type GithubAssetMutationRequest = GithubMutationRequest & {
	readonly path: string;
};

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export class ProviderInspection extends Context.Service<
	ProviderInspection,
	{
		readonly inspect_npm: (
			request: InspectArtifactRequest,
		) => Effect.Effect<ProviderState, unknown>;
		readonly inspect_openvsx: (
			request: InspectArtifactRequest,
		) => Effect.Effect<ProviderState, unknown>;
		readonly inspect_github: (
			request: InspectGithubRequest,
		) => Effect.Effect<GithubInspection, unknown>;
	}
>()("svelte-effect-runtime/release/ProviderInspection") {}

export class ProviderMutation extends Context.Service<
	ProviderMutation,
	{
		readonly require_credentials: (channel: ReleaseChannel) => Effect.Effect<void, unknown>;
		readonly create_github_tag: (
			request: GithubMutationRequest,
		) => Effect.Effect<void, unknown>;
		readonly upsert_draft_github_release: (
			request: GithubMutationRequest,
		) => Effect.Effect<void, unknown>;
		readonly publish_npm: (request: PublishArtifactRequest) => Effect.Effect<void, unknown>;
		readonly publish_openvsx: (request: PublishArtifactRequest) => Effect.Effect<void, unknown>;
		readonly upload_github_asset: (
			request: GithubAssetMutationRequest,
		) => Effect.Effect<void, unknown>;
		readonly finalize_github_release: (
			request: GithubMutationRequest,
		) => Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime/release/ProviderMutation") {}

const NpmVersionSchema = Schema.Struct({
	dist: Schema.Struct({ integrity: Schema.String }),
});
const OpenVsxVersionSchema = Schema.Struct({
	files: Schema.Struct({ sha256: Schema.String }),
});
const GithubRefSchema = Schema.Struct({
	object: Schema.Struct({ sha: Schema.String, type: Schema.String }),
});
const GithubTagSchema = Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) });
const GithubAssetSchema = Schema.Struct({
	name: Schema.String,
	url: Schema.String,
	digest: Schema.NullOr(Schema.String),
});
const GithubReleaseSchema = Schema.Struct({
	tag_name: Schema.String,
	html_url: Schema.String,
	name: Schema.NullOr(Schema.String),
	body: Schema.NullOr(Schema.String),
	draft: Schema.Boolean,
	assets: Schema.Array(GithubAssetSchema),
});
const GithubReleaseListSchema = Schema.Array(GithubReleaseSchema);

type JsonResponse = {
	readonly response: Response;
	readonly body: unknown;
};

const openvsx_namespace = "barekey";
const openvsx_extension = "svelte-effect-runtime-vscode";

export const ProviderInspectionLive = Layer.succeed(ProviderInspection, {
	inspect_npm: (request) =>
		InspectNpm(request).pipe(
			Effect.catch((cause) =>
				Effect.succeed(
					provider_unavailable(npm_url(request.package_name, request.version), cause),
				),
			),
		),
	inspect_openvsx: (request) =>
		InspectOpenVsx(request).pipe(
			Effect.catch((cause) =>
				Effect.succeed(provider_unavailable(openvsx_url(request.version), cause)),
			),
		),
	inspect_github: (request) =>
		InspectGithub(request).pipe(
			Effect.catch((cause) => Effect.succeed(unavailable_github_inspection(request, cause))),
		),
});

export const ProviderMutationLive = Layer.effect(
	ProviderMutation,
	Effect.gen(function* () {
		const node_services = yield* Effect.context<NodeServices.NodeServices>();
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const Run = (
			command: string,
			args: ReadonlyArray<string>,
			cwd: string,
			timeout_ms: number,
		) =>
			RunCommand(command, args, cwd).pipe(
				Effect.provide(node_services),
				Effect.timeoutOrElse({
					duration: Duration.millis(timeout_ms),
					orElse: () =>
						Effect.fail(
							new Error(`${command} exceeded its ${timeout_ms}ms command timeout.`),
						),
				}),
				Effect.asVoid,
			);

		const RunGithub = (request: GithubMutationRequest, args: ReadonlyArray<string>) =>
			Run("gh", args, process.cwd(), request.timeout_ms);

		return {
			require_credentials: (channel) =>
				Effect.sync(() => {
					const available =
						channel === "npm"
							? has_npm_publish_auth(process.env)
							: channel === "openvsx"
								? Boolean(process.env.OVSX_PAT ?? process.env.OPEN_VSX_TOKEN)
								: Boolean(process.env.GH_TOKEN);

					if (!available) {
						throw new Error(`Missing required ${channel} promotion credential.`);
					}
				}),
			create_github_tag: (request) =>
				RunGithub(request, [
					"api",
					"--method",
					"POST",
					`repos/${request.repository}/git/refs`,
					"-f",
					`ref=refs/tags/${request.tag}`,
					"-f",
					`sha=${request.commit}`,
				]),
			upsert_draft_github_release: (request) =>
				RunGithub(
					request,
					request.release_exists
						? [
								"release",
								"edit",
								request.tag,
								"--draft",
								"--title",
								request.tag,
								"--notes",
								request.notes,
								"--repo",
								request.repository,
							]
						: [
								"release",
								"create",
								request.tag,
								"--draft",
								"--verify-tag",
								"--title",
								request.tag,
								"--notes",
								request.notes,
								"--repo",
								request.repository,
							],
				),
			publish_npm: (request) =>
				Effect.gen(function* () {
					const npm_command = process.platform === "win32" ? "npm.cmd" : "npm";
					const token_variable = process.env.NPM_TOKEN
						? "NPM_TOKEN"
						: process.env.NODE_AUTH_TOKEN
							? "NODE_AUTH_TOKEN"
							: undefined;
					const publish_args = [
						"publish",
						request.path,
						"--access",
						"public",
						"--provenance",
					];

					if (!token_variable) {
						yield* Run(npm_command, publish_args, request.cwd, request.timeout_ms);

						return;
					}

					yield* Effect.scoped(
						Effect.gen(function* () {
							const temp_dir = yield* file_system.makeTempDirectoryScoped({
								prefix: "ser-npm-publish-",
							});
							const npmrc_path = path.join(temp_dir, ".npmrc");

							yield* file_system.writeFileString(
								npmrc_path,
								`//registry.npmjs.org/:_authToken=\${${token_variable}}\n`,
							);
							yield* Run(
								npm_command,
								[...publish_args, "--userconfig", npmrc_path],
								request.cwd,
								request.timeout_ms,
							);
						}),
					);
				}),
			publish_openvsx: (request) =>
				WithTemporaryEnvironment(
					"OVSX_PAT",
					process.env.OPEN_VSX_TOKEN ?? process.env.OVSX_PAT ?? "",
					Run(
						"corepack",
						["pnpm", "exec", "ovsx", "publish", request.path],
						request.cwd,
						request.timeout_ms,
					),
				),
			upload_github_asset: (request) =>
				RunGithub(request, [
					"release",
					"upload",
					request.tag,
					request.path,
					"--repo",
					request.repository,
				]),
			finalize_github_release: (request) =>
				RunGithub(request, [
					"release",
					"edit",
					request.tag,
					"--draft=false",
					"--repo",
					request.repository,
				]),
		};
	}),
);

export const ProviderAdaptersLive = Layer.merge(ProviderInspectionLive, ProviderMutationLive);

export function has_npm_publish_auth(environment: ProviderEnvironment): boolean {
	const has_token = Boolean(environment.NPM_TOKEN?.trim() || environment.NODE_AUTH_TOKEN?.trim());
	const has_oidc = Boolean(
		environment.ACTIONS_ID_TOKEN_REQUEST_URL?.trim() &&
		environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim(),
	);

	return has_token || has_oidc;
}

const InspectNpm = (request: InspectArtifactRequest) =>
	Effect.gen(function* () {
		const url = npm_url(request.package_name, request.version);
		const result = yield* FetchJson(url, request.timeout_ms);
		const observed_digest =
			result.response.status === 200
				? Schema.decodeUnknownSync(NpmVersionSchema)(result.body).dist.integrity
				: undefined;

		return classify_provider_state({
			_tag: "HttpResponse",
			provider: "npm",
			status: result.response.status,
			url,
			expected_digest: request.expected_digest,
			...(observed_digest ? { observed_digest } : {}),
		});
	});

const InspectOpenVsx = (request: InspectArtifactRequest) =>
	Effect.gen(function* () {
		const version_url = openvsx_url(request.version);
		const version_result = yield* FetchJson(version_url, request.timeout_ms);

		if (version_result.response.status !== 200) {
			return classify_provider_state({
				_tag: "HttpResponse",
				provider: "openvsx",
				status: version_result.response.status,
				url: version_url,
				expected_digest: request.expected_digest,
			});
		}

		const version = Schema.decodeUnknownSync(OpenVsxVersionSchema)(version_result.body);
		const checksum_result = yield* FetchText(version.files.sha256, request.timeout_ms);

		return classify_provider_state({
			_tag: "HttpResponse",
			provider: "openvsx",
			status: checksum_result.response.status,
			url: version.files.sha256,
			expected_digest: request.expected_digest,
			...(checksum_result.response.status === 200
				? { observed_digest: checksum_result.body }
				: {}),
		});
	});

const InspectGithub = (request: InspectGithubRequest) =>
	Effect.gen(function* () {
		const [tag, release_result] = yield* Effect.all(
			[InspectGithubTag(request), FetchGithubRelease(request)] as const,
			{ concurrency: "unbounded" },
		);
		const release = make_github_release_state(request, release_result);
		const assets = make_github_asset_states(request, release_result);

		return { tag, release, assets };
	});

const InspectGithubTag = (request: InspectGithubRequest) =>
	Effect.gen(function* () {
		const url = github_api_url(
			request.repository,
			`git/ref/tags/${encodeURIComponent(request.tag)}`,
		);
		const result = yield* FetchJson(url, request.timeout_ms);

		if (result.response.status !== 200) {
			return identity_from_http(url, result.response.status, request.commit);
		}

		const reference = Schema.decodeUnknownSync(GithubRefSchema)(result.body);
		const actual =
			reference.object.type === "tag"
				? yield* ResolveAnnotatedTag(request, reference.object.sha)
				: reference.object.sha;

		return actual === request.commit
			? ({ _tag: "Matching", url, actual } as const)
			: ({ _tag: "Mismatched", url, expected: request.commit, actual } as const);
	});

const ResolveAnnotatedTag = (request: InspectGithubRequest, tag_sha: string) =>
	Effect.gen(function* () {
		const url = github_api_url(request.repository, `git/tags/${tag_sha}`);
		const result = yield* FetchJson(url, request.timeout_ms);

		if (result.response.status !== 200) {
			return yield* Effect.fail(
				new Error(
					`Unable to resolve annotated GitHub tag: HTTP ${result.response.status}.`,
				),
			);
		}

		return Schema.decodeUnknownSync(GithubTagSchema)(result.body).object.sha;
	});

const FetchGithubRelease = (request: InspectGithubRequest) =>
	Effect.gen(function* () {
		const tag_url = github_api_url(
			request.repository,
			`releases/tags/${encodeURIComponent(request.tag)}`,
		);
		const by_tag = yield* FetchJson(tag_url, request.timeout_ms);

		if (by_tag.response.status !== 404) {
			return by_tag;
		}

		const releases_url = github_api_url(request.repository, "releases?per_page=100");

		return yield* FetchGithubReleaseFromList(request, releases_url, by_tag);
	});

const FetchGithubReleaseFromList = (
	request: InspectGithubRequest,
	url: string,
	not_found: JsonResponse,
): Effect.Effect<JsonResponse, unknown> =>
	Effect.gen(function* () {
		const releases = yield* FetchJson(url, request.timeout_ms);

		if (releases.response.status !== 200) {
			return releases;
		}

		const draft = find_github_release_by_tag(releases.body, request.tag);

		if (draft) {
			return { response: releases.response, body: draft };
		}

		const next_page = github_next_page(releases.response.headers);

		if (next_page._tag === "Rejected") {
			return yield* Effect.fail(new Error(next_page.reason));
		}

		return next_page._tag === "Next"
			? yield* FetchGithubReleaseFromList(request, next_page.url, not_found)
			: not_found;
	});

export function find_github_release_by_tag(body: unknown, tag: string) {
	return Schema.decodeUnknownSync(GithubReleaseListSchema)(body).find(
		(release) => release.tag_name === tag,
	);
}

export function github_next_page(headers: Headers) {
	const link = headers.get("link");
	const next_entry = link
		?.split(",")
		.map((entry) => entry.trim())
		.find((entry) => entry.endsWith('rel="next"'));

	if (!next_entry) {
		return { _tag: "Complete" } as const;
	}

	const next = next_entry.match(/^<([^>]+)>/)?.[1];

	if (!next?.startsWith("https://api.github.com/")) {
		return {
			_tag: "Rejected",
			reason: "GitHub release pagination returned an unsafe next link.",
		} as const;
	}

	return { _tag: "Next", url: next } as const;
}

function make_github_release_state(
	request: InspectGithubRequest,
	result: JsonResponse,
): GithubReleaseState {
	const url = github_api_url(
		request.repository,
		`releases/tags/${encodeURIComponent(request.tag)}`,
	);

	if (result.response.status !== 200) {
		return identity_from_http(url, result.response.status, request.tag);
	}

	const release = Schema.decodeUnknownSync(GithubReleaseSchema)(result.body);
	const title_matches = release.name === request.tag;
	const notes_match = release.body === request.notes;
	const unexpected_asset = release.assets.find(
		(asset) => !request.assets.some((expected) => expected.name === asset.name),
	);

	if (unexpected_asset) {
		return {
			_tag: "Mismatched",
			url: release.html_url,
			expected: request.assets.map((asset) => asset.name).join(","),
			actual: release.assets.map((asset) => asset.name).join(","),
			draft: release.draft,
			notes_match,
		};
	}

	if (!title_matches) {
		return {
			_tag: "Mismatched",
			url: release.html_url,
			expected: request.tag,
			actual: release.name ?? "",
			draft: release.draft,
			notes_match,
		};
	}

	if (!notes_match) {
		return {
			_tag: "Mismatched",
			url: release.html_url,
			expected: "release notes matching the verified commit",
			actual: "release notes differ",
			draft: release.draft,
			notes_match,
		};
	}

	return {
		_tag: "Matching",
		url: release.html_url,
		actual: release.draft ? "draft" : "published",
		draft: release.draft,
		notes_match,
	};
}

function make_github_asset_states(
	request: InspectGithubRequest,
	result: JsonResponse,
): Readonly<Record<string, ProviderState>> {
	const release_url = github_api_url(
		request.repository,
		`releases/tags/${encodeURIComponent(request.tag)}`,
	);

	if (result.response.status !== 200) {
		return Object.fromEntries(
			request.assets.map((asset) => [
				asset.name,
				classify_provider_state({
					_tag: "HttpResponse",
					provider: "github-release",
					status: result.response.status,
					url: release_url,
					expected_digest: asset.expected_digest,
				}),
			]),
		);
	}

	const release = Schema.decodeUnknownSync(GithubReleaseSchema)(result.body);

	return Object.fromEntries(
		request.assets.map((expected) => {
			const asset = release.assets.find((candidate) => candidate.name === expected.name);

			return [
				expected.name,
				asset
					? classify_provider_state({
							_tag: "HttpResponse",
							provider: "github-release",
							status: 200,
							url: asset.url,
							expected_digest: expected.expected_digest,
							...(asset.digest ? { observed_digest: asset.digest } : {}),
						})
					: classify_provider_state({
							_tag: "HttpResponse",
							provider: "github-release",
							status: 404,
							url: `${release.html_url}#${encodeURIComponent(expected.name)}`,
							expected_digest: expected.expected_digest,
						}),
			] as const;
		}),
	);
}

const FetchJson = (url: string, timeout_ms: number) =>
	Effect.tryPromise({
		try: async () => {
			const headers = github_headers(url);
			const response = await fetch(url, {
				...(headers ? { headers } : {}),
				signal: AbortSignal.timeout(timeout_ms),
			});
			const body = response.status === 204 ? undefined : await response.json();

			return { response, body } satisfies JsonResponse;
		},
		catch: (cause) => cause,
	});

const FetchText = (url: string, timeout_ms: number) =>
	Effect.tryPromise({
		try: async () => {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(timeout_ms),
			});
			const body = await response.text();

			return { response, body };
		},
		catch: (cause) => cause,
	});

const WithTemporaryEnvironment = <A, E>(name: string, value: string, effect: Effect.Effect<A, E>) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const previous = process.env[name];

			process.env[name] = value;

			return previous;
		}),
		() => effect,
		(previous) =>
			Effect.sync(() => {
				if (previous === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = previous;
				}
			}),
	);

function identity_from_http(url: string, status: number, expected: string): GithubIdentityState {
	if (status === 404) {
		return { _tag: "Absent", url };
	}

	if (status === 401 || status === 403) {
		return { _tag: "AuthenticationFailure", url, status };
	}

	if (status === 408 || status === 429 || status >= 500) {
		return {
			_tag: "ProviderUnavailable",
			url,
			status,
			reason: `GitHub returned HTTP ${status}.`,
		};
	}

	return {
		_tag: "ProviderRejected",
		url,
		status,
		reason: `GitHub rejected inspection of ${expected} with HTTP ${status}.`,
	};
}

function provider_unavailable(url: string, cause: unknown): ProviderState {
	return {
		_tag: "ProviderUnavailable",
		url,
		status: undefined,
		reason: format_cause(cause),
	};
}

function unavailable_github_inspection(
	request: InspectGithubRequest,
	cause: unknown,
): GithubInspection {
	const reason = format_cause(cause);
	const url = github_api_url(request.repository, "releases");
	const unavailable: GithubIdentityState = {
		_tag: "ProviderUnavailable",
		url,
		status: undefined,
		reason,
	};
	const assets = Object.fromEntries(
		request.assets.map((asset) => [asset.name, provider_unavailable(url, cause)]),
	);

	return { tag: unavailable, release: unavailable, assets };
}

function format_cause(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function npm_url(package_name: string, version: string): string {
	return `https://registry.npmjs.org/${encodeURIComponent(package_name)}/${encodeURIComponent(version)}`;
}

function openvsx_url(version: string): string {
	return `https://open-vsx.org/api/${openvsx_namespace}/${openvsx_extension}/${encodeURIComponent(version)}`;
}

function github_api_url(repository: string, resource: string): string {
	return `https://api.github.com/repos/${repository}/${resource}`;
}

function github_headers(url: string): HeadersInit | undefined {
	if (!url.startsWith("https://api.github.com/")) {
		return undefined;
	}

	const authorization = process.env.GH_TOKEN?.trim();

	return {
		Accept: "application/vnd.github+json",
		"User-Agent": "svelte-effect-runtime-release",
		"X-GitHub-Api-Version": "2022-11-28",
		...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
	};
}
