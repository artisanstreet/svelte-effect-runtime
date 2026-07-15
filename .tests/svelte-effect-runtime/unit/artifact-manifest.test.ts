import { read_packed_artifact_version } from "../consumer/harness/artifact-manifest.ts";
import { assert_command_succeeded, run_command } from "../public-api/packed-artifact.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("custom artifact provenance comes from the packed manifest", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ser-artifact-manifest-"));
	const package_directory = join(directory, "package");
	const artifact_path = join(directory, "candidate.tgz");

	try {
		await mkdir(package_directory);
		await writeFile(
			join(package_directory, "package.json"),
			`${JSON.stringify({ name: "svelte-effect-runtime", version: "9.8.7" })}\n`,
		);

		const packed = run_command("tar", ["-czf", artifact_path, "package"], directory);

		assert_command_succeeded("pack provenance fixture", packed);

		await expect(read_packed_artifact_version(artifact_path, directory)).resolves.toBe("9.8.7");
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
