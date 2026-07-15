import { find_workflow_policy_violations } from "../../../build/ci/workflow-policy.ts";
import { parse } from "yaml";
import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "vitest";

test("the authoritative workflow preserves release safety and exact artifact promotion", async () => {
	const [workflow_source, setup_source, workflow_files] = await Promise.all([
		readFile(".github/workflows/ci.yml", "utf8"),
		readFile(".github/actions/setup/action.yml", "utf8"),
		readdir(".github/workflows"),
	]);
	const violations = find_workflow_policy_violations({
		workflow: parse(workflow_source),
		setup_action: parse(setup_source),
		workflow_files,
	});

	expect(violations).toEqual([]);
});

test("workflow policy rejects a master publication path", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.promote.if = "github.ref == 'refs/heads/master'";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("promote must be gated on a manual candidate dispatch.");
});
