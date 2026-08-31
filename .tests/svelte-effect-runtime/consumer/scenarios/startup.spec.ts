import { resolve_sveltekit_target_names } from "../harness/sveltekit-profiles.ts";
import { get_conformance_proxy_url } from "../../unit/harness/model.ts";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { make_evidence } from "../../unit/harness/evidence.ts";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { Schema } from "effect";

const targets = resolve_sveltekit_target_names(process.env);
const repo_root = resolve(import.meta.dirname, "../../../../");
const candidate_build_root = resolve(repo_root, ".dist/conformance/applications/candidate/build");
const StartupBody = Schema.Struct({
	client: Schema.Literal("missing"),
	request_id: Schema.Literal("ssr"),
	route: Schema.Literal("/api/context"),
	session: Schema.Literal("missing"),
	url: Schema.Literal("/api/context"),
});

test("packed candidate runtime excludes compiler-only CommonJS dependencies", async () => {
	const entries = await readdir(candidate_build_root, { recursive: true });
	const javascript_files = entries.filter((entry) => entry.endsWith(".js"));
	const leaking_files: string[] = [];

	for (const entry of javascript_files) {
		const path = resolve(candidate_build_root, entry);
		const source = await readFile(path, "utf8");

		if (source.includes("__filename") || source.includes("getNodeSystem")) {
			leaking_files.push(entry);
		}
	}

	expect(leaking_files).toEqual([]);
});

test("production adapter servers start and answer through named HTTPS origins", async ({
	request,
}, test_info) => {
	for (const target of targets) {
		const target_url = get_conformance_proxy_url(target);
		const response = await request.get(`${target_url}/api/context`);

		expect(response.status()).toBe(200);

		const body = Schema.decodeUnknownSync(StartupBody)(await response.json());
		const evidence = make_evidence(
			".dist/conformance/evidence",
			"playwright-startup",
			"server-start",
			target,
			"start",
			"readiness.json",
			{ target_url },
		);
		const payload = {
			body,
			evidence,
			status: response.status(),
		};
		const evidence_path = resolve(repo_root, evidence.path);

		await mkdir(dirname(evidence_path), { recursive: true });
		await writeFile(evidence_path, `${JSON.stringify(payload, null, "\t")}\n`);
		await test_info.attach(`${target}-startup-evidence`, {
			body: JSON.stringify(payload, null, "\t"),
			contentType: "application/json",
		});
	}
});
