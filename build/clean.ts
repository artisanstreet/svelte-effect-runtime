import { join, readdir, remove_path, repo_root } from "./node-utils.ts";

type CleanTarget = {
	paths: string[];
	files?: Array<{
		directory: string;
		extensions: string[];
	}>;
};

const target_names = [
	"svelte-effect-runtime",
	"svelte-effect-runtime-grammars",
	"svelte-effect-runtime-language-server",
	"svelte-effect-runtime-vsix",
	"docs",
] as const;
const clean_targets: Record<string, CleanTarget> = {
	"svelte-effect-runtime": {
		paths: [
			join(repo_root, ".dist", "svelte-effect-runtime"),
			join(repo_root, "modules", "svelte-effect-runtime", ".dist"),
			join(repo_root, "modules", "svelte-effect-runtime", ".tmp"),
		],
		files: [
			{
				directory: join(repo_root, "modules", "svelte-effect-runtime"),
				extensions: [".tgz"],
			},
		],
	},
	"svelte-effect-runtime-grammars": {
		paths: [
			join(repo_root, ".dist", "svelte-effect-runtime-grammars"),
			join(repo_root, "modules", "svelte-effect-runtime-grammars", ".dist"),
		],
		files: [
			{
				directory: join(repo_root, "modules", "svelte-effect-runtime-grammars"),
				extensions: [".tgz"],
			},
		],
	},
	"svelte-effect-runtime-language-server": {
		paths: [
			join(repo_root, ".dist", "svelte-effect-runtime-language-server"),
			join(repo_root, "modules", "svelte-effect-runtime-language-server", ".dist"),
			join(repo_root, "modules", "svelte-effect-runtime-language-server", ".tmp"),
			join(repo_root, "modules", "svelte-effect-runtime-language-server", "runtime"),
		],
		files: [
			{
				directory: join(repo_root, "modules", "svelte-effect-runtime-language-server"),
				extensions: [".tgz"],
			},
		],
	},
	"svelte-effect-runtime-vsix": {
		paths: [
			join(repo_root, ".dist", "svelte-effect-runtime-vsix"),
			join(repo_root, "modules", "svelte-effect-runtime-vsix", ".dist"),
			join(repo_root, "modules", "svelte-effect-runtime-vsix", "runtime"),
		],
		files: [
			{
				directory: join(repo_root, "modules", "svelte-effect-runtime-vsix"),
				extensions: [".vsix"],
			},
		],
	},
	docs: {
		paths: [
			join(repo_root, "modules", "docs", ".next"),
			join(repo_root, "modules", "docs", ".source"),
			join(repo_root, "modules", "docs", ".vercel"),
			join(repo_root, "modules", "docs", "next-env.d.ts"),
		],
	},
};

const targets = process.argv.length > 2 ? process.argv.slice(2) : [...target_names];

for (const target of targets) {
	if (!target_names.includes(target as (typeof target_names)[number])) {
		throw new Error(`Unknown clean target: ${target}`);
	}

	const config = clean_targets[target];

	for (const path of config.paths) {
		await remove_path(path);
	}

	for (const file_config of config.files ?? []) {
		await remove_matching_files(file_config.directory, file_config.extensions);
	}
}

if (targets.length === target_names.length) {
	await remove_path(join(repo_root, ".dist"));
	await remove_path(join(repo_root, ".tmp"));
}

async function remove_matching_files(directory: string, extensions: string[]): Promise<void> {
	let entries;

	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}

		if (!extensions.some((extension) => entry.name.endsWith(extension))) {
			continue;
		}

		await remove_path(join(directory, entry.name));
	}
}
