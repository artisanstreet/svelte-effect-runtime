import {
	copyFile,
	cp,
	command_name,
	is_not_found_error,
	join,
	make_temp_dir,
	mkdir,
	readFile,
	remove_path,
	repo_root,
	run_command,
	writeFile,
} from "./node-utils.ts";

const package_dir = join(repo_root, "modules", "svelte-effect-runtime-vsix");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime-vsix");
const extension_files = ["extension.cjs", "extension.cjs.map"] as const;

const staging_dir = await make_temp_dir("svelte-effect-runtime-vsix-");
const staging_dist_dir = join(staging_dir, ".dist");

try {
	await prepare_staging();
	await copy_extension_output();

	const manifest = await write_manifest();

	await package_extension(manifest);
} finally {
	await remove_path(staging_dir);
}

async function prepare_staging(): Promise<void> {
	await mkdir(staging_dist_dir, { recursive: true });
}

async function copy_extension_output(): Promise<void> {
	await cp(join(output_dir, "chunks"), join(staging_dist_dir, "chunks"), {
		force: true,
		recursive: true,
	}).catch((error) => {
		if (!is_not_found_error(error)) {
			throw error;
		}
	});

	for (const filename of extension_files) {
		await copyFile(join(output_dir, filename), join(staging_dist_dir, filename)).catch(
			(error) => {
				if (!is_not_found_error(error)) {
					throw error;
				}
			},
		);
	}

	await copyFile(join(package_dir, "README.md"), join(staging_dir, "README.md"));
	await copyFile(join(repo_root, "LICENSE"), join(staging_dir, "LICENSE"));
}

async function write_manifest(): Promise<Record<string, unknown>> {
	const manifest = JSON.parse(await readFile(join(package_dir, "package.json"), "utf8"));

	await writeFile(
		join(staging_dir, "package.json"),
		`${JSON.stringify(prepare_manifest(manifest), null, 2)}\n`,
	);

	return manifest;
}

async function package_extension(manifest: Record<string, unknown>) {
	const output_name = `${manifest.name}-${manifest.version}.vsix`;

	await mkdir(output_dir, { recursive: true });
	await remove_path(join(output_dir, output_name));
	await run_command(
		command_name("corepack"),
		[
			"pnpm",
			"dlx",
			"@vscode/vsce@3.7.1",
			"package",
			"--allow-missing-repository",
			"--no-dependencies",
			"--out",
			join(output_dir, output_name),
		],
		staging_dir,
		{ inherit: true },
	);
}

function prepare_manifest(manifest: Record<string, unknown>) {
	const files = Array.isArray(manifest.files)
		? manifest.files.filter((value): value is string => typeof value === "string")
		: [];

	return {
		...manifest,
		packageManager: "pnpm@11.10.0",
		files,
	};
}
