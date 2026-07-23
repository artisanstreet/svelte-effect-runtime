import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RepoRoot } from "./node-utils.ts";

type AliasPattern = {
	prefix: string;
	resolve(specifier: string): string;
};

type TargetConfig = {
	aliases: AliasPattern[];
};

type TargetContext = {
	package_name: string;
	dist_root: string;
	repo_root: string;
	target: TargetConfig;
};

const target_names = ["svelte-effect-runtime", "svelte-effect-runtime-grammars"] as const;

const targets: Record<(typeof target_names)[number], TargetConfig> = {
	"svelte-effect-runtime": {
		aliases: [
			{
				prefix: "$/",
				resolve(specifier: string): string {
					return specifier.slice(2).replace(/\.ts$/, ".js");
				},
			},
		],
	},
	"svelte-effect-runtime-grammars": {
		aliases: [],
	},
} satisfies Record<string, TargetConfig>;

const TargetNameSchema = Schema.Literals(target_names);

const Main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_name = yield* Schema.decodeUnknownEffect(TargetNameSchema)(process.argv[2]);
	const target = targets[package_name];
	const context: TargetContext = {
		package_name,
		target,
		repo_root,
		dist_root: path.join(repo_root, ".dist", package_name).replaceAll("\\", "/"),
	};

	yield* VisitRoot(context);
	yield* InstallEnvironmentDeclarations(context);
});

const InstallEnvironmentDeclarations = (context: TargetContext) =>
	Effect.gen(function* () {
		if (context.package_name !== "svelte-effect-runtime") {
			return;
		}

		const file_system = yield* FileSystem.FileSystem;
		const source_path = `${context.repo_root}/modules/svelte-effect-runtime/src/environment/virtual-modules.d.ts`;
		const output_path = `${context.dist_root}/environment/virtual-modules.d.ts`;
		const entry_path = `${context.dist_root}/environment.d.ts`;
		const reference = `/// <reference path="./environment/virtual-modules.d.ts" />`;
		const declarations = yield* file_system.readFileString(source_path);
		const entry = yield* file_system.readFileString(entry_path);

		yield* file_system.writeFileString(output_path, declarations);
		yield* file_system.writeFileString(entry_path, `${reference}\n\n${entry}`);
	});

const VisitRoot = (context: TargetContext) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const entries = yield* file_system.readDirectory(context.dist_root);

		for (const entry of entries) {
			yield* Visit(context, entry);
		}
	});

function Visit(
	context: TargetContext,
	relative_path: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const file_path = `${context.dist_root}/${relative_path}`.replaceAll("\\", "/");
		const file_stat = yield* file_system.stat(file_path);

		if (file_stat.type === "Directory") {
			const entries = yield* file_system.readDirectory(file_path);

			for (const entry of entries) {
				yield* Visit(context, `${relative_path}/${entry}`);
			}

			return;
		}

		if (!file_path.endsWith(".d.ts")) {
			return;
		}

		const content = yield* file_system.readFileString(file_path);
		const aliases_rewritten = yield* RewriteAliasSpecifiers(context, file_path, content);
		const rewritten = rewrite_relative_specifiers(aliases_rewritten);

		if (rewritten !== content) {
			yield* file_system.writeFileString(file_path, rewritten);
		}
	});
}

const RewriteAliasSpecifiers = (context: TargetContext, file_path: string, content: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;

		if (context.target.aliases.length === 0) {
			return content;
		}

		return content.replace(
			/(["'])(\$\/[^"']+\.ts)\1/g,
			(match, quote: string, specifier: string) => {
				const alias = context.target.aliases.find(({ prefix }) =>
					specifier.startsWith(prefix),
				);

				if (!alias) {
					return match;
				}

				const resolved_target =
					`${context.dist_root}/${alias.resolve(specifier)}`.replaceAll("\\", "/");
				const from_dir = file_path.slice(0, file_path.lastIndexOf("/"));
				const relative_path = path
					.relative(from_dir, resolved_target)
					.replaceAll("\\", "/");
				const specifier_path = relative_path.startsWith(".")
					? relative_path
					: `./${relative_path}`;

				return `${quote}${specifier_path}${quote}`;
			},
		);
	});

function rewrite_relative_specifiers(content: string): string {
	return content.replace(/((?:from|import)\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
