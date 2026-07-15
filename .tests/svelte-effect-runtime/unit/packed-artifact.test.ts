import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { acquire_directory_lock, publish_packed_artifact } from "../public-api/packed-artifact.ts";
import { spawnSync } from "node:child_process";
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

test("packed artifact build lock never reclaims a slow active owner", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ser-packed-lock-"));
	const lock_path = join(directory, "build.lock");
	const lock_options = {
		retry_ms: 5,
		stale_after_ms: 1,
		timeout_ms: 25,
	};

	try {
		await acquire_directory_lock(lock_path, lock_options);

		const old = new Date(Date.now() - 10_000);

		await utimes(lock_path, old, old);
		await expect(acquire_directory_lock(lock_path, lock_options)).rejects.toThrow(
			`Timed out waiting for the directory lock at ${lock_path}.`,
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("packed artifact build lock serializes concurrent stale-lock recovery", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ser-packed-stale-lock-"));
	const lock_path = join(directory, "build.lock");
	const lock_options = {
		retry_ms: 2,
		stale_after_ms: 1,
		timeout_ms: 25,
	};

	try {
		const dead_owner = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });

		expect(dead_owner.status).toBe(0);
		await mkdir(lock_path);
		await writeFile(
			join(lock_path, "owner.json"),
			`${JSON.stringify({ pid: dead_owner.pid })}\n`,
		);

		const old = new Date(Date.now() - 10_000);

		await utimes(lock_path, old, old);

		const attempts = await Promise.allSettled(
			Array.from({ length: 10 }, () => acquire_directory_lock(lock_path, lock_options)),
		);
		const acquired = attempts.filter((attempt) => attempt.status === "fulfilled");

		expect(acquired).toHaveLength(1);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
