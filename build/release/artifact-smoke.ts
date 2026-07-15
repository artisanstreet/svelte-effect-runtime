import { ReadArtifactManifest, ReadCanonicalReleasePlan, ReadPlannedArtifacts } from "./io.ts";
import { validate_artifact_manifest, type ArtifactManifest } from "./artifact-manifest.ts";
import { CommandName, MakeTempDirScoped, RunCommand } from "../node-utils.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { pathToFileURL } from "node:url";

export type ArtifactSmokeRequest = {
	readonly plan_path: string;
	readonly manifest_path: string;
	readonly artifact_dir: string;
};

export type ArtifactSmokeResult = {
	readonly version: string;
	readonly artifact_names: ReadonlyArray<string>;
	readonly consumer_artifacts: ReadonlyArray<string>;
	readonly vsix: VsixInspection;
};

export type ConsumerSmokeRequest = {
	readonly version: string;
	readonly artifact_paths: ReadonlyArray<string>;
};

export type VsixInspection = {
	readonly name: string;
	readonly version: string;
	readonly main: string;
	readonly extension_byte_size: number;
};

export class ArtifactConsumer extends Context.Service<
	ArtifactConsumer,
	{
		readonly verify: (request: ConsumerSmokeRequest) => Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime/release/ArtifactConsumer") {}

const VsixPackageSchema = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	main: Schema.String,
});

const artifact_extensions = [".tgz", ".vsix"] as const;
const vsix_manifest_path = "extension/package.json";
const vsix_main_path = "extension/.dist/extension.cjs";

const consumer_smoke_source = `const [runtime, compiler, grammars] = await Promise.all([
  import("svelte-effect-runtime"),
  import("svelte-effect-runtime/compiler"),
  import("svelte-effect-runtime-grammars"),
]);

const language_server_url = import.meta.resolve("svelte-effect-runtime-language-server");
const checks = [
  ["runtime ClientRuntime", typeof runtime.ClientRuntime === "function"],
  ["runtime Query", typeof runtime.Query === "function"],
  ["compiler effect", typeof compiler.effect === "function"],
  ["compiler plugins", compiler.effect().length > 0],
  ["TextMate grammar", typeof grammars.textmate?.scope_name === "string"],
  ["tree-sitter grammar", typeof grammars.tree_sitter?.highlights_query === "string"],
  ["language server", language_server_url.includes("svelte-effect-runtime-language-server")],
];
const failed = checks.find(([, passed]) => !passed);

if (failed) {
  throw new Error(\`Artifact consumer check failed: \${failed[0]}.\`);
}
`;

export const ArtifactConsumerLive = Layer.effect(
	ArtifactConsumer,
	Effect.gen(function* () {
		const node_services = yield* Effect.context<NodeServices.NodeServices>();

		return {
			verify: (request) =>
				VerifyConsumerArtifacts(request).pipe(Effect.provide(node_services)),
		};
	}),
);

export const SmokeReleaseArtifacts = (request: ArtifactSmokeRequest) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const consumer = yield* ArtifactConsumer;
		const plan = yield* ReadCanonicalReleasePlan(request.plan_path);
		const files = yield* ReadPlannedArtifacts(plan, request.artifact_dir);
		const external_manifest = yield* ReadArtifactManifest(request.manifest_path);
		const manifest = validate_artifact_manifest(plan, external_manifest, files);

		yield* ValidateArtifactFileSet(request.artifact_dir, manifest);

		const vsix_entry = require_manifest_entry(manifest, "vsix");
		const vsix_file = files.find((file) => file.name === vsix_entry.name);

		if (!vsix_file) {
			return yield* Effect.fail(new Error(`Missing VSIX artifact ${vsix_entry.name}.`));
		}

		const vsix = yield* Effect.try({
			try: () => inspect_vsix_artifact(vsix_file.bytes, plan.version),
			catch: (cause) => cause,
		});
		const consumer_artifacts = manifest.artifacts
			.filter((artifact) => artifact.kind === "npm-tarball")
			.map((artifact) => path.join(request.artifact_dir, artifact.name));

		yield* consumer.verify({ version: plan.version, artifact_paths: consumer_artifacts });

		return {
			version: plan.version,
			artifact_names: manifest.artifacts.map((artifact) => artifact.name),
			consumer_artifacts,
			vsix,
		} satisfies ArtifactSmokeResult;
	});

export function inspect_vsix_artifact(bytes: Uint8Array, version: string): VsixInspection {
	const entries = unzipSync(bytes, {
		filter: (entry) => entry.name === vsix_manifest_path || entry.name === vsix_main_path,
	});
	const manifest_bytes = entries[vsix_manifest_path];
	const extension_bytes = entries[vsix_main_path];

	if (!manifest_bytes) {
		throw new Error(`VSIX is missing ${vsix_manifest_path}.`);
	}

	if (!extension_bytes || extension_bytes.byteLength === 0) {
		throw new Error(`VSIX is missing a non-empty ${vsix_main_path}.`);
	}

	const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(VsixPackageSchema))(
		strFromU8(manifest_bytes),
	);

	if (manifest.name !== "svelte-effect-runtime-vscode") {
		throw new Error(
			`VSIX package name is ${manifest.name}, expected svelte-effect-runtime-vscode.`,
		);
	}

	if (manifest.version !== version) {
		throw new Error(`VSIX version is ${manifest.version}, expected ${version}.`);
	}

	if (manifest.main !== "./.dist/extension.cjs") {
		throw new Error(`VSIX main is ${manifest.main}, expected ./.dist/extension.cjs.`);
	}

	return {
		name: manifest.name,
		version: manifest.version,
		main: manifest.main,
		extension_byte_size: extension_bytes.byteLength,
	};
}

export function make_consumer_install_args(
	artifact_paths: ReadonlyArray<string>,
): ReadonlyArray<string> {
	if (artifact_paths.length !== 3 || artifact_paths.some((path) => !path.endsWith(".tgz"))) {
		throw new Error("Artifact consumer requires exactly three npm tarballs.");
	}

	return ["pnpm", "add", "--ignore-scripts", ...artifact_paths];
}

export function parse_artifact_smoke_request(args: ReadonlyArray<string>): ArtifactSmokeRequest {
	const allowed_flags = new Set(["plan", "manifest", "artifact-dir"]);
	const flags: Record<string, string> = {};

	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		const name = flag?.startsWith("--") ? flag.slice(2) : undefined;

		if (!name || !allowed_flags.has(name)) {
			throw new Error(`Unknown argument ${flag ?? "none"}.`);
		}

		if (!value || value.startsWith("--")) {
			throw new Error(`Argument --${name} requires a value.`);
		}

		if (flags[name] !== undefined) {
			throw new Error(`Argument --${name} was supplied more than once.`);
		}

		flags[name] = value;
	}

	const plan_path = flags.plan;
	const manifest_path = flags.manifest;
	const artifact_dir = flags["artifact-dir"];

	if (!plan_path || !manifest_path || !artifact_dir) {
		throw new Error("Artifact smoke requires --plan, --manifest, and --artifact-dir.");
	}

	return { plan_path, manifest_path, artifact_dir };
}

const VerifyConsumerArtifacts = (request: ConsumerSmokeRequest) =>
	Effect.scoped(
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const consumer_dir = yield* MakeTempDirScoped("ser-artifact-consumer-");
			const corepack = yield* CommandName("corepack");
			const node = yield* CommandName("node");
			const package_manifest = {
				name: "ser-release-artifact-consumer",
				private: true,
				type: "module",
				packageManager: "pnpm@11.10.0",
			};

			yield* file_system.writeFileString(
				path.join(consumer_dir, "package.json"),
				`${JSON.stringify(package_manifest, null, 2)}\n`,
			);
			yield* file_system.writeFileString(
				path.join(consumer_dir, "artifact-smoke.mjs"),
				consumer_smoke_source,
			);
			yield* RunCommand(
				corepack,
				make_consumer_install_args(request.artifact_paths),
				consumer_dir,
				{ inherit: true },
			);
			yield* RunCommand(node, ["artifact-smoke.mjs"], consumer_dir, { inherit: true });
		}),
	);

const ValidateArtifactFileSet = (artifact_dir: string, manifest: ArtifactManifest) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const entries = yield* file_system.readDirectory(artifact_dir);
		const actual_names = entries
			.filter((entry) => artifact_extensions.some((extension) => entry.endsWith(extension)))
			.sort();
		const expected_names = manifest.artifacts.map((artifact) => artifact.name).sort();
		const matches =
			actual_names.length === expected_names.length &&
			actual_names.every((name, index) => name === expected_names[index]);

		if (!matches) {
			return yield* Effect.fail(
				new Error(
					`Artifact directory must contain exactly ${expected_names.join(", ")}; found ${actual_names.join(", ") || "none"}.`,
				),
			);
		}
	});

function require_manifest_entry(manifest: ArtifactManifest, package_id: "vsix") {
	const entry = manifest.artifacts.find((artifact) => artifact.package_id === package_id);

	if (!entry) {
		throw new Error(`Artifact manifest is missing ${package_id}.`);
	}

	return entry;
}

const Main = Effect.gen(function* () {
	const request = yield* Effect.try({
		try: () => parse_artifact_smoke_request(process.argv.slice(2)),
		catch: (cause) => cause,
	});
	const result = yield* SmokeReleaseArtifacts(request);

	yield* Effect.log(`Verified release artifacts for ${result.version}.`);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(
		Main.pipe(Effect.provide(ArtifactConsumerLive), Effect.provide(NodeServices.layer)),
	);
}
