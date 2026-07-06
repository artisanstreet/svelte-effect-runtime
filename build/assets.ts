import {
	copyFile,
	cp,
	is_not_found_error,
	join,
	mkdir,
	path_exists,
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

const optional_runtime_files = [
	"preprocess.js",
	"mod.js",
	"generators.js",
	"dispatcher.js",
	"detect.js",
] as const;
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

for (const filename of optional_runtime_files) {
	try {
		await copyFile(join(runtime_dist, filename), join(runtime_dir, filename));
	} catch (error) {
		if (!is_not_found_error(error)) {
			throw error;
		}
	}
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
