import {
	copyFile,
	cp,
	join,
	mkdir,
	path_exists,
	readdir,
	readFile,
	remove_path,
	repo_root,
	writeFile,
} from "./node-utils.ts";

const target = process.argv[2];
const runtime_dist = join(repo_root, ".dist", "svelte-effect-runtime");
const runtime_manifest_path = join(repo_root, "modules", "svelte-effect-runtime", "package.json");
const target_dist_dir = join(repo_root, ".dist", target ?? "");
const runtime_dir = join(target_dist_dir, "runtime");

const runtime_directories = ["chunks", "internal", "markup", "remote", "runtime"];

if (!target) {
	throw new Error("Expected target package name.");
}

if (!(await path_exists(runtime_dist))) {
	throw new Error(`Runtime .dist not found at ${runtime_dist}`);
}

await mkdir(target_dist_dir, { recursive: true });
await remove_path(runtime_dir);
await mkdir(runtime_dir, { recursive: true });

const runtime_manifest = JSON.parse(await readFile(runtime_manifest_path, "utf8"));
const runtime_package_json = {
	type: "module",
	dependencies: {
		svelte: runtime_manifest.peerDependencies?.svelte,
		typescript: runtime_manifest.dependencies?.typescript,
	},
};

await writeFile(
	join(runtime_dir, "package.json"),
	`${JSON.stringify(runtime_package_json, null, 2)}\n`,
);

const runtime_root_files = await readdir(runtime_dist, { withFileTypes: true });

for (const file of runtime_root_files) {
	if (!file.isFile() || !is_runtime_asset_file(file.name)) {
		continue;
	}

	await copyFile(join(runtime_dist, file.name), join(runtime_dir, file.name));
}

for (const directory of runtime_directories) {
	const source_dir = join(runtime_dist, directory);
	const target_dir = join(runtime_dir, directory);

	if (!(await path_exists(source_dir))) {
		continue;
	}

	await mkdir(target_dir, { recursive: true });
	await cp(source_dir, target_dir, {
		force: true,
		recursive: true,
	});
}

await writeFile(join(runtime_dir, "transform.js"), `export * from "./runtime/transform.js";\n`);
await writeFile(join(runtime_dir, "transform.d.ts"), `export * from "./runtime/transform";\n`);

function is_runtime_asset_file(filename: string): boolean {
	return filename.endsWith(".js") || filename.endsWith(".js.map") || filename.endsWith(".d.ts");
}
