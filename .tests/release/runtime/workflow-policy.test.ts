import { find_workflow_policy_violations } from "../../../build/ci/workflow-policy.ts";
import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

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

	workflow.jobs.github_prepare.if = "github.ref == 'refs/heads/master'";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy reads the candidate guard from the job condition", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.github_prepare.if = "true";
	workflow.jobs.github_prepare.env = {
		UNRELATED_PROOF: "workflow_dispatch refs/heads/candidate",
	};

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy rejects a widened candidate guard", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.github_prepare.if = `${workflow.jobs.github_prepare.if} || true`;

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("github_prepare must be gated on a manual candidate dispatch.");
});

test("workflow policy rejects extra publication authority", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.npm_publish.permissions.packages = "write";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("npm publication must use only read access and OIDC authority.");
});

test("workflow policy requires GitHub-hosted npm trusted publishing", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.npm_publish["runs-on"] = "blacksmith-4vcpu-ubuntu-2404";

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("npm trusted publishing must run on a GitHub-hosted runner.");
});

test("workflow policy rejects direct shell interpolation of manual inputs", async () => {
	const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8"));
	const setup_action = parse(await readFile(".github/actions/setup/action.yml", "utf8"));

	workflow.jobs.plan.steps.push({ run: 'echo "${{ inputs.resume_commit }}"' });

	const violations = find_workflow_policy_violations({
		workflow,
		setup_action,
		workflow_files: ["ci.yml"],
	});

	expect(violations).toContain("plan interpolates manual input directly into a shell script.");
});
