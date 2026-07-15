import { assert_equals, assert_string_includes } from "./helpers/assert.ts";
import {
	record_server_output,
	wait_for_child_close,
} from "../consumer/harness/record-server-output.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Schema } from "effect";
import { expect, test } from "vitest";

const ProcessMetadata = Schema.Struct({
	arguments: Schema.Array(Schema.String),
	command: Schema.String,
	cwd: Schema.String,
	exit_code: Schema.Number,
	finished_at: Schema.String,
	started_at: Schema.String,
});
const InitialProcessMetadata = Schema.Struct({
	command: Schema.String,
	exit_code: Schema.Null,
});

test("server output recorder waits for stdio close after process exit", async () => {
	const child = new EventEmitter();
	const completion = wait_for_child_close(child);
	let settled = false;

	completion.finally(() => {
		settled = true;
	});
	child.emit("exit", 0);
	await Promise.resolve();

	expect(settled).toBe(false);

	child.emit("close", 0);

	await expect(completion).resolves.toBe(0);
});

test("server output recorder rejects launch failures after writing initial evidence", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "ser-server-output-launch-"));
	const evidence_dir = join(workspace, "evidence");
	const command = join(workspace, "missing-command");

	try {
		await expect(
			record_server_output({
				arguments_: [],
				command,
				cwd: workspace,
				evidence_dir,
			}),
		).rejects.toThrow();

		const metadata_source = await readFile(join(evidence_dir, "process.json"), "utf8");
		const metadata = Schema.decodeUnknownSync(InitialProcessMetadata)(
			JSON.parse(metadata_source),
		);

		expect(metadata).toMatchObject({ command, exit_code: null });
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
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

test("server output recorder drains buffered output before finalizing evidence", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "ser-server-output-close-"));
	const recorder = resolve(
		".tests/svelte-effect-runtime/consumer/harness/record-server-output.ts",
	);
	const child_source = [
		`const { writeSync } = require("node:fs");`,
		`const chunk = Buffer.alloc(65_536, 120);`,
		`for (let index = 0; index < 64; index += 1) writeSync(1, chunk);`,
		`writeSync(1, Buffer.from("output-complete\\n"));`,
	].join("");

	try {
		const result = spawnSync(
			process.execPath,
			[recorder, "--evidence-dir", workspace, "--", process.execPath, "-e", child_source],
			{ encoding: "utf8", maxBuffer: 8_388_608, windowsHide: true },
		);
		const stdout = await readFile(join(workspace, "stdout.log"), "utf8");

		assert_equals(result.status, 0);
		assert_equals(stdout.length, 4_194_320);
		assert_string_includes(stdout.slice(-16), "output-complete\n");
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
});
