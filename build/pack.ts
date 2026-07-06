import {
	command_name,
	copyFile,
	cp,
	is_not_found_error,
	join,
	mkdir,
	path_exists,
	readFile,
	relative,
	remove_path,
	repo_root,
	run_command,
	writeFile,
} from "./node-utils.ts";

const package_name = process.argv[2];

if (!package_name) {
	throw new Error("Expected package directory name.");
}

const package_dir = join(repo_root, "modules", package_name);
const output_dir = join(repo_root, ".dist", package_name);
const staging_dir = join(repo_root, ".tmp", "pack", package_name);
const staging_dist_dir = join(staging_dir, ".dist");
const package_manifest_path = join(package_dir, "package.json");
const dependency_fields = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

if (!(await path_exists(output_dir))) {
	throw new Error(`Package build output not found at ${output_dir}`);
}

await remove_path(staging_dir);
await mkdir(staging_dir, { recursive: true });
await copy_package_output();
await copy_package_manifest();
await copy_standard_files();
await copy_manifest_files();

const pack_output = await run_command(
	command_name("corepack"),
	["pnpm", "pack", "--pack-destination", output_dir, "--json"],
	staging_dir,
);

console.log(pack_output.stdout.trim());

async function copy_package_output(): Promise<void> {
	const manifest = JSON.parse(await readFile(package_manifest_path, "utf8"));
	const side_files = get_manifest_side_files(manifest);

	await cp(output_dir, staging_dist_dir, {
		filter(source) {
			const relative_path = relative(output_dir, source).replaceAll("\\", "/");
			const is_artifact = source.endsWith(".tgz") || source.endsWith(".vsix");
			const is_side_file = side_files.some(
				(file) => relative_path === file || relative_path.startsWith(`${file}/`),
			);

			return !is_artifact && !is_side_file;
		},
		force: true,
		recursive: true,
	});
}

function get_manifest_side_files(manifest: Record<string, unknown>): string[] {
	const files = Array.isArray(manifest.files)
		? manifest.files.filter((value): value is string => typeof value === "string")
		: [];

	return files.filter((file) => file !== ".dist" && file !== "README.md" && file !== "LICENSE");
}

async function copy_package_manifest(): Promise<void> {
	const manifest = JSON.parse(await readFile(package_manifest_path, "utf8"));
	const publish_manifest = await prepare_publish_manifest(manifest);

	await writeFile(
		join(staging_dir, "package.json"),
		`${JSON.stringify(publish_manifest, null, 2)}\n`,
	);
}

async function prepare_publish_manifest(
	manifest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	for (const field of dependency_fields) {
		const dependencies = manifest[field];

		if (!dependencies || typeof dependencies !== "object") {
			continue;
		}

		const dependency_map = dependencies as Record<string, unknown>;

		for (const [name, version] of Object.entries(dependency_map)) {
			if (typeof version !== "string" || !version.startsWith("workspace:")) {
				continue;
			}

			dependency_map[name] = await resolve_workspace_version(name, version);
		}
	}

	return manifest;
}

async function resolve_workspace_version(name: string, specifier: string): Promise<string> {
	const version = specifier.slice("workspace:".length);

	if (version && version !== "*" && version !== "^" && version !== "~") {
		return version;
	}

	const workspace_manifest_path = join(repo_root, "modules", name, "package.json");
	const workspace_manifest = JSON.parse(await readFile(workspace_manifest_path, "utf8"));

	if (typeof workspace_manifest.version !== "string") {
		throw new Error(`Workspace package ${name} is missing a version.`);
	}

	return version === "^" || version === "~"
		? `${version}${workspace_manifest.version}`
		: workspace_manifest.version;
}

async function copy_standard_files(): Promise<void> {
	await copy_optional(join(package_dir, "README.md"), join(staging_dir, "README.md"));
	await copy_optional(join(repo_root, "LICENSE"), join(staging_dir, "LICENSE"));
}

async function copy_manifest_files(): Promise<void> {
	const manifest = JSON.parse(await readFile(package_manifest_path, "utf8"));
	const files = get_manifest_side_files(manifest);

	for (const file of files) {
		await copy_manifest_file(file);
	}
}

async function copy_manifest_file(file: string): Promise<void> {
	const package_path = join(package_dir, file);
	const output_path = join(output_dir, file);
	const staging_path = join(staging_dir, file);

	if (await path_exists(package_path)) {
		await cp(package_path, staging_path, {
			force: true,
			recursive: true,
		});

		return;
	}

	if (await path_exists(output_path)) {
		await cp(output_path, staging_path, {
			force: true,
			recursive: true,
		});
	}
}

async function copy_optional(source: string, target: string): Promise<void> {
	try {
		await copyFile(source, target);
	} catch (error) {
		if (!is_not_found_error(error)) {
			throw error;
		}
	}
}
