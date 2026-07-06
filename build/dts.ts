import { join, readFile, readdir, relative, repo_root, stat, writeFile } from "./node-utils.ts";

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
	target: TargetConfig;
};

const targets: Record<string, TargetConfig> = {
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
};

const context = resolve_target();

await visit_root(context);

function resolve_target(): TargetContext {
	const package_name = process.argv[2];

	if (!package_name) {
		throw new Error("Expected package name.");
	}

	const target = targets[package_name];

	if (!target) {
		throw new Error(`Unknown declaration target: ${package_name}`);
	}

	return {
		package_name,
		target,
		dist_root: join(repo_root, ".dist", package_name).replaceAll("\\", "/"),
	};
}

async function visit_root(context: TargetContext): Promise<void> {
	const entries = await readdir(context.dist_root, { withFileTypes: true });

	for (const entry of entries) {
		await visit(context, entry.name);
	}
}

async function visit(context: TargetContext, relative_path: string): Promise<void> {
	const file_path = `${context.dist_root}/${relative_path}`.replaceAll("\\", "/");
	const file_stat = await stat(file_path);

	if (file_stat.isDirectory()) {
		const entries = await readdir(file_path, { withFileTypes: true });

		for (const entry of entries) {
			await visit(context, `${relative_path}/${entry.name}`);
		}

		return;
	}

	if (!file_path.endsWith(".d.ts")) {
		return;
	}

	const content = await readFile(file_path, "utf8");
	const rewritten = rewrite_relative_specifiers(
		rewrite_alias_specifiers(context, file_path, content),
	);

	if (rewritten !== content) {
		await writeFile(file_path, rewritten);
	}
}

function rewrite_alias_specifiers(
	context: TargetContext,
	file_path: string,
	content: string,
): string {
	if (context.target.aliases.length === 0) {
		return content;
	}

	return content.replace(
		/(["'])(\$\/[^"']+\.ts)\1/g,
		(match, quote: string, specifier: string) => {
			const alias = context.target.aliases.find(({ prefix }) => specifier.startsWith(prefix));

			if (!alias) {
				return match;
			}

			return `${quote}${to_posix_relative(context, file_path, alias.resolve(specifier))}${quote}`;
		},
	);
}

function rewrite_relative_specifiers(content: string): string {
	return content.replace(/((?:from|import)\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
}

function to_posix_relative(
	context: TargetContext,
	from_file: string,
	target_from_dist: string,
): string {
	const resolved_target = `${context.dist_root}/${target_from_dist}`.replaceAll("\\", "/");
	const from_dir = from_file.slice(0, from_file.lastIndexOf("/"));
	const relative_path = relative(from_dir, resolved_target).replaceAll("\\", "/");

	return relative_path.startsWith(".") ? relative_path : `./${relative_path}`;
}
