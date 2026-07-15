import { assert_equals, assert_string_includes } from "./helpers/assert.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Schema } from "effect";
import { test } from "vitest";

const ProcessMetadata = Schema.Struct({
	arguments: Schema.Array(Schema.String),
	command: Schema.String,
	cwd: Schema.String,
	exit_code: Schema.Number,
	finished_at: Schema.String,
	started_at: Schema.String,
});

test("server output recorder tees both streams and preserves the child exit status", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "ser-server-output-"));
	const recorder = resolve(
		".tests/svelte-effect-runtime/consumer/harness/record-server-output.ts",
	);
	const child_source = [
		`process.stdout.write("server-ready\\n");`,
		`process.stderr.write("server-warning\\n");`,
		`process.exitCode = 7;`,
	].join("");

	try {
		const result = spawnSync(
			process.execPath,
			[recorder, "--evidence-dir", workspace, "--", process.execPath, "-e", child_source],
			{ encoding: "utf8", windowsHide: true },
		);
		const stdout = await readFile(join(workspace, "stdout.log"), "utf8");
		const stderr = await readFile(join(workspace, "stderr.log"), "utf8");
		const metadata_source = await readFile(join(workspace, "process.json"), "utf8");
		const metadata = Schema.decodeUnknownSync(ProcessMetadata)(JSON.parse(metadata_source));

		assert_equals(result.status, 7);
		assert_string_includes(result.stdout, "server-ready");
		assert_string_includes(result.stderr, "server-warning");
		assert_equals(stdout, "server-ready\n");
		assert_equals(stderr, "server-warning\n");
		assert_equals(metadata.exit_code, 7);
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
});
