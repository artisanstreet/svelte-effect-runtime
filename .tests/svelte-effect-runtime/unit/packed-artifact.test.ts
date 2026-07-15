import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { publish_packed_artifact } from "../public-api/packed-artifact.ts";
import { expect, test } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("packed artifact publication exposes one complete archive under concurrent writers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ser-packed-artifact-"));
	const first_path = join(directory, "first.tgz");
	const second_path = join(directory, "second.tgz");
	const artifact_path = join(directory, "artifact.tgz");
	const first = Buffer.alloc(1_048_576, 17);
	const second = Buffer.alloc(1_048_576, 29);

	try {
		await writeFile(first_path, first);
		await writeFile(second_path, second);
		await Promise.all([
			publish_packed_artifact(first_path, artifact_path),
			publish_packed_artifact(second_path, artifact_path),
		]);

		const published = await readFile(artifact_path);
		const entries = await readdir(directory);

		expect([published.equals(first), published.equals(second)]).toContain(true);
		expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
