import { conformance_proxy_port, conformance_proxy_protocol } from "../../unit/harness/model.ts";
import { make_evidence } from "../../unit/harness/evidence.ts";
import type { TargetName } from "../../unit/harness/model.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { Schema } from "effect";

const targets = ["native", "stable", "candidate"] as const satisfies readonly TargetName[];
const repo_root = resolve(import.meta.dirname, "../../../../");
const StartupBody = Schema.Struct({
	client: Schema.Literal("missing"),
	request_id: Schema.Literal("ssr"),
	route: Schema.Literal("/api/context"),
	session: Schema.Literal("missing"),
	url: Schema.Literal("/api/context"),
});

test("production adapter servers start and answer through named HTTPS origins", async ({
	request,
}, test_info) => {
	for (const target of targets) {
		const target_url = `${conformance_proxy_protocol}://ser-conformance-${target}.localhost:${conformance_proxy_port}`;
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
